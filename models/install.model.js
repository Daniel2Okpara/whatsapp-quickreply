const mongoose = require('mongoose');

const installSchema = new mongoose.Schema({
  chromeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    default: null
  },
  installDate: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  version: {
    type: String,
    default: '1.0.0'
  },
  platform: {
    type: String,
    default: 'chrome'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  registered: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Install', installSchema);
