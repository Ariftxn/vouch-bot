const mongoose = require('mongoose');

const VouchSchema = new mongoose.Schema({
    voucherId: { type: String, required: true },
    voucheeId: { type: String, required: true },
    reason: { type: String, required: true },
    color: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// Index untuk mempercepat validasi sistem anti-duplikat
VouchSchema.index({ voucherId: 1, voucheeId: 1 });

module.exports = mongoose.model('Vouch', VouchSchema);
