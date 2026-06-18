const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  event: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String },
  source: { type: String, enum: ['extension', 'landing', 'admin'], default: 'extension' },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Analytics', analyticsSchema);
