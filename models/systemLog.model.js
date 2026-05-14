const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['ai_failure', 'auth_failure', 'webhook_failure', 'system_error', 'ai_feedback'], required: true },
  message: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String }, 
  source: { type: String, enum: ['backend', 'extension', 'admin'], default: 'backend' },
  endpoint: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemLog', systemLogSchema);
