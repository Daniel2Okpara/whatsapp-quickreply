const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['ai_failure', 'auth_failure', 'webhook_failure', 'system_error'], required: true },
  message: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  email: { type: String }, // optional user context
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemLog', systemLogSchema);
