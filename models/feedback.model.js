const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String },
  suggestion: { type: String, required: true },
  feedback: { type: String, enum: ['up', 'down'], required: true },
  context: { type: mongoose.Schema.Types.Mixed }, // conversation snippet etc
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AIFeedback', feedbackSchema);
