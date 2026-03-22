const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    logChannelId: { type: String, required: true }
});

module.exports = mongoose.model('Config', ConfigSchema);
