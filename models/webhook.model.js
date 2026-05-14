const mongoose = require('mongoose');

const webhookSchema = new mongoose.Schema({
  eventId: { type: String, unique: true, sparse: true }, // Paddle v2 event_id
  hash: { type: String, required: true, unique: true }, // Legacy hash
  alertName: { type: String },
  subscriptionId: { type: String },
  rawBody: { type: String },
  status: { type: String, enum: ['processing', 'done', 'failed', 'ignored'], default: 'processing' },
  isProcessed: { type: Boolean, default: false },
  attempts: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date }
});

module.exports = mongoose.model('WebhookLog', webhookSchema);
