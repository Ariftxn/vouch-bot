require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    PermissionFlagsBits,
    ApplicationCommandOptionType 
} = require('discord.js');
const mongoose = require('mongoose');
const Vouch = require('./models/Vouch');
const Config = require('./models/Config');

// --- KONEKSI DATABASE ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Berhasil terhubung ke sistem Database MongoDB.'))
    .catch(err => console.error('❌ Mohon maaf, gagal terhubung ke Database:', err));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
    ],
});

// --- REGEX UNTUK MEMBACA PESAN ---
const vouchRegex = /^(?:v|vouch)\s*<@!?(\d+)>(.*)/is;
const checkRegex = /^(?:vcheck|vstats)\s*<@!?(\d+)>/is;
const topRegex = /^(?:vtop|vleaderboard)/is;

// --- MEMORI SEMENTARA UNTUK ANTI-SPAM ---
const recentVouches = new Map();

// --- EVENT: BOT MENYALA ---
client.once('ready', async () => {
    console.log(`🤖 Bot beroperasi dengan baik sebagai ${client.user.tag}`);

    // Mendaftarkan Slash Command /setup ke sistem Discord
    try {
        await client.application.commands.set([
            {
                name: 'setup',
                description: 'Mengatur saluran (channel) khusus untuk riwayat Vouch masuk.',
                defaultMemberPermissions: PermissionFlagsBits.Administrator, // Hanya Admin
                options: [
                    {
                        name: 'channel',
                        type: ApplicationCommandOptionType.Channel,
                        description: 'Silakan pilih saluran (channel) tujuan',
                        required: true
                    }
                ]
            }
        ]);
        console.log('✅ Slash Command /setup berhasil didaftarkan ke server.');
    } catch (error) {
        console.error('❌ Gagal mendaftarkan Slash Command:', error);
    }
});

// --- EVENT: MENANGANI SLASH COMMAND ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');

        try {
            // Menyimpan pengaturan channel ke dalam Database
            await Config.findOneAndUpdate(
                { guildId: interaction.guildId },
                { logChannelId: channel.id },
                { upsert: true, new: true }
            );

            return interaction.reply({ 
                content: `✅ Pengaturan berhasil disimpan. Seluruh riwayat Vouch yang valid akan dikirimkan secara otomatis ke saluran <#${channel.id}>.`, 
                ephemeral: true 
            });
        } catch (error) {
            console.error(error);
            return interaction.reply({ 
                content: 'Mohon maaf, terjadi kesalahan pada sistem saat menyimpan pengaturan. Silakan coba beberapa saat lagi.', 
                ephemeral: true 
            });
        }
    }
});

// --- EVENT: MENANGANI PESAN TEKS ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // 1. FITUR: LEADERBOARD (Peringkat Reputasi)
    if (topRegex.test(message.content)) {
        await message.channel.sendTyping();
        try {
            const topUsers = await Vouch.aggregate([
                { $group: { _id: "$voucheeId", total: { $sum: 1 } } },
                { $sort: { total: -1 } },
                { $limit: 10 }
            ]);

            if (topUsers.length === 0) {
                return message.reply("📊 Mohon maaf, belum ada riwayat reputasi yang tercatat di server ini.");
            }

            const embedTop = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Top 10 Peringkat Reputasi')
                .setDescription('Berikut adalah daftar anggota dengan jumlah Vouch terbanyak:')
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .setTimestamp();

            let leaderboardText = "";
            for (let i = 0; i < topUsers.length; i++) {
                const userId = topUsers[i]._id;
                const totalVouches = topUsers[i].total;
                const user = await client.users.fetch(userId).catch(() => null);
                const username = user ? user.username : `*Pengguna Tidak Dikenal*`;
                
                let rankIcon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
                leaderboardText += `${rankIcon} **#${i + 1}** • <@${userId}> (${username}) — **${totalVouches} Vouch**\n`;
            }

            embedTop.addFields({ name: '\u200B', value: leaderboardText });
            return message.reply({ embeds: [embedTop] }).catch(console.error);
        } catch (error) {
            console.error(error);
            return message.reply("Mohon maaf, terjadi kesalahan pada sistem saat memuat data peringkat.").catch(console.error);
        }
    }

    // 2. FITUR: CEK REPUTASI PRIBADI
    const checkMatch = message.content.match(checkRegex);
    if (checkMatch) {
        const targetId = checkMatch[1];
        try {
            const userVouches = await Vouch.find({ voucheeId: targetId }).sort({ createdAt: -1 });
            const targetUser = await client.users.fetch(targetId).catch(() => null);

            if (!targetUser) {
                return message.reply("Mohon maaf, pengguna tersebut tidak dapat ditemukan di dalam sistem.").catch(console.error);
            }

            const embedProfile = new EmbedBuilder()
                .setColor('#5865F2')
                .setAuthor({ name: `Profil Reputasi: ${targetUser.username}`, iconURL: targetUser.displayAvatarURL() })
                .setDescription(`**Total Vouch Terverifikasi:** \`${userVouches.length}\``)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }));

            if (userVouches.length > 0) {
                const latestReviews = userVouches.slice(0, 3).map((v, i) => 
                    `**${i + 1}.** Dari <@${v.voucherId}>\n> *"${v.reason}"*`
                ).join('\n\n');
                embedProfile.addFields({ name: '📝 3 Ulasan Terbaru', value: latestReviews });
            } else {
                embedProfile.addFields({ name: '📝 Ulasan', value: '*Belum ada ulasan yang diberikan untuk pengguna ini.*' });
            }
            return message.reply({ embeds: [embedProfile] }).catch(console.error);
        } catch (error) {
            console.error(error);
            return message.reply("Mohon maaf, terjadi kendala saat memeriksa profil pengguna.").catch(console.error);
        }
    }

    // 3. FITUR UTAMA: MEMBERIKAN VOUCH
    const vouchMatch = message.content.match(vouchRegex);
    if (vouchMatch) {
        const targetId = vouchMatch[1];
        let reason = vouchMatch[2].trim() || "Tidak ada alasan spesifik yang dilampirkan.";
        const authorId = message.author.id;

        // Validasi 1: Anti Self-Vouch
        if (authorId === targetId) {
            return message.reply("Mohon maaf, Anda tidak diizinkan untuk memberikan Vouch kepada diri sendiri.").catch(console.error);
        }

        // Validasi 2: Anti-Spam (Maksimal 3 Vouch per menit)
        const now = Date.now();
        const timestamps = recentVouches.get(authorId) || [];
        const recentActivity = timestamps.filter(time => now - time < 60000);
        
        if (recentActivity.length >= 3) {
            return message.reply("⚠️ Sistem mendeteksi aktivitas yang terlalu cepat. Mohon tunggu sejenak sebelum memberikan Vouch kembali.").catch(console.error);
        }
        recentActivity.push(now);
        recentVouches.set(authorId, recentActivity);

        try {
            // Validasi 3: Anti-Duplikat dalam 30 hari
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const existingVouch = await Vouch.findOne({ 
                voucherId: authorId, 
                voucheeId: targetId,
                createdAt: { $gte: thirtyDaysAgo }
            });

            const color = generateVibrantHex(); // Warna RGB dinamis

            if (existingVouch) {
                existingVouch.reason = reason;
                existingVouch.color = color;
                existingVouch.createdAt = new Date();
                await existingVouch.save();
                message.reply(`✅ Vouch Anda untuk <@${targetId}> telah berhasil diperbarui di dalam sistem.`).catch(console.error);
            } else {
                await Vouch.create({
                    voucherId: authorId,
                    voucheeId: targetId,
                    reason: reason,
                    color: color
                });
                message.reply(`✅ Vouch telah berhasil diberikan kepada <@${targetId}>. Terima kasih!`).catch(console.error);
            }

            // Sistem Dashboard In-Discord (Mengirim ke Log Channel)
            const guildConfig = await Config.findOne({ guildId: message.guild.id });
            
            if (guildConfig && guildConfig.logChannelId) {
                const logChannel = client.channels.cache.get(guildConfig.logChannelId);
                if (logChannel) {
                    const embedLog = new EmbedBuilder()
                        .setColor(color)
                        .setAuthor({ name: `Vouch Baru dari ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
                        .setDescription(`**Penerima:** <@${targetId}>\n**Alasan:** ${reason}`)
                        .setFooter({ text: 'Sistem Terverifikasi Automatis' })
                        .setTimestamp();
                    logChannel.send({ embeds: [embedLog] }).catch(console.error);
                }
            }

        } catch (error) {
            console.error(error);
            message.reply("Mohon maaf, terjadi gangguan teknis saat mencoba memproses Vouch Anda. Silakan hubungi Administrator.").catch(console.error);
        }
    }
});

// Fungsi Pendukung: Membuat warna Hex cerah bergaya RGB
function generateVibrantHex() {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 20) + 80; 
    const l = Math.floor(Math.random() * 10) + 50; 
    const a = s * Math.min(l, 100 - l) / 10000;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

client.login(process.env.DISCORD_TOKEN);
