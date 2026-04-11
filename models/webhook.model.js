const mongoose = require('mongoose');

const webhookSchema = new mongoose.Schema({
  hash: { type: String, required: true, unique: true },
  alertName: { type: String },
  subscriptionId: { type: String },
  rawBody: { type: String },
  status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
  attempts: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date }
});

module.exports = mongoose.model('WebhookLog', webhookSchema);
