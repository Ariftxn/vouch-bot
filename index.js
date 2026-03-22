require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const Vouch = require('./models/Vouch');

// --- KONEKSI DATABASE ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Terhubung ke MongoDB'))
    .catch(err => console.error('❌ Gagal konek DB:', err));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // WAJIB AKTIF DI DISCORD DEVELOPER PORTAL
    ],
});

// --- REGEX COMMANDS ---
const vouchRegex = /^(?:v|vouch)\s*<@!?(\d+)>(.*)/is;
const checkRegex = /^(?:vcheck|vstats)\s*<@!?(\d+)>/is;
const topRegex = /^(?:vtop|vleaderboard)/is;

// --- MEMORI ANTI-SPAM ---
const recentVouches = new Map();

client.once('ready', () => {
    console.log(`🤖 Bot Ready sebagai ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // ==========================================
    // 1. FITUR LEADERBOARD (vtop)
    // ==========================================
    if (topRegex.test(message.content)) {
        await message.channel.sendTyping();
        try {
            const topUsers = await Vouch.aggregate([
                { $group: { _id: "$voucheeId", total: { $sum: 1 } } },
                { $sort: { total: -1 } },
                { $limit: 10 }
            ]);

            if (topUsers.length === 0) return message.reply("📊 Belum ada data vouch di server ini.");

            const embedTop = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Top 10 Reputasi Tertinggi')
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .setTimestamp();

            let leaderboardText = "";
            for (let i = 0; i < topUsers.length; i++) {
                const userId = topUsers[i]._id;
                const totalVouches = topUsers[i].total;
                
                // Coba fetch user dari Discord cache/API
                const user = await client.users.fetch(userId).catch(() => null);
                const username = user ? user.username : `*Unknown User*`;

                let rankIcon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
                leaderboardText += `${rankIcon} **#${i + 1}** • <@${userId}> (${username}) — **${totalVouches} Vouch**\n`;
            }

            embedTop.addFields({ name: '\u200B', value: leaderboardText });
            return message.reply({ embeds: [embedTop] });
        } catch (error) {
            console.error(error);
            return message.reply("❌ Terjadi kesalahan saat mengambil data leaderboard.");
        }
    }

    // ==========================================
    // 2. FITUR CEK REPUTASI (vcheck @user)
    // ==========================================
    const checkMatch = message.content.match(checkRegex);
    if (checkMatch) {
        const targetId = checkMatch[1];
        const userVouches = await Vouch.find({ voucheeId: targetId }).sort({ createdAt: -1 });
        const targetUser = await client.users.fetch(targetId).catch(() => null);

        if (!targetUser) return message.reply("❌ User tidak ditemukan.");

        const embedProfile = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: `Profil Reputasi: ${targetUser.username}`, iconURL: targetUser.displayAvatarURL() })
            .setDescription(`**Total Vouch Valid:** \`${userVouches.length}\``)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }));

        if (userVouches.length > 0) {
            const latestReviews = userVouches.slice(0, 3).map((v, i) => 
                `**${i + 1}.** Dari <@${v.voucherId}>\n> *"${v.reason}"*`
            ).join('\n\n');
            embedProfile.addFields({ name: '📝 3 Review Terbaru', value: latestReviews });
        } else {
            embedProfile.addFields({ name: '📝 Review', value: '*Belum ada vouch untuk user ini.*' });
        }
        return message.reply({ embeds: [embedProfile] });
    }

    // ==========================================
    // 3. FITUR VOUCH (v @user alasan)
    // ==========================================
    const vouchMatch = message.content.match(vouchRegex);
    if (vouchMatch) {
        const targetId = vouchMatch[1];
        let reason = vouchMatch[2].trim() || "Tidak ada alasan spesifik.";
        const authorId = message.author.id;

        // Anti Self-Vouch
        if (authorId === targetId) return message.reply("❌ Kamu tidak bisa vouch diri sendiri.");

        // Anti-Spam (Max 3 vouch / menit)
        const now = Date.now();
        const timestamps = recentVouches.get(authorId) || [];
        const recentActivity = timestamps.filter(time => now - time < 60000);
        
        if (recentActivity.length >= 3) {
            return message.reply("⚠️ Slow down! Kamu vouch terlalu cepat.");
        }
        recentActivity.push(now);
        recentVouches.set(authorId, recentActivity);

        try {
            // Anti-Dupe / Update Vouch dalam 30 hari
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const existingVouch = await Vouch.findOne({ 
                voucherId: authorId, 
                voucheeId: targetId,
                createdAt: { $gte: thirtyDaysAgo }
            });

            const color = generateVibrantHex(); // "RGB" Feel

            if (existingVouch) {
                existingVouch.reason = reason;
                existingVouch.color = color;
                existingVouch.createdAt = new Date();
                await existingVouch.save();
                message.reply(`✅ Vouch kamu untuk <@${targetId}> telah di-update!`);
            } else {
                await Vouch.create({
                    voucherId: authorId,
                    voucheeId: targetId,
                    reason: reason,
                    color: color
                });
                message.reply(`✅ Berhasil memberikan vouch ke <@${targetId}>!`);
            }

            // Kirim ke Log Channel
            const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                const embedLog = new EmbedBuilder()
                    .setColor(color)
                    .setAuthor({ name: `Vouch Baru dari ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
                    .setDescription(`**Penerima:** <@${targetId}>\n**Alasan:** ${reason}`)
                    .setFooter({ text: 'Valid Vouch Terverifikasi' })
                    .setTimestamp();
                logChannel.send({ embeds: [embedLog] });
            }

        } catch (error) {
            console.error(error);
            message.reply("❌ Terjadi kesalahan teknis saat menyimpan vouch.");
        }
    }
});

// Utility: Generate warna RGB cerah
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
