const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { 
    type: String, 
    required: true, 
    unique: true
  },
  emailsUsed: [{ 
    type: String 
  }], // All emails that have authenticated on this device
  trialUsed: { 
    type: Boolean, 
    default: false 
  }, // PERMANENT FLAG
  trialHistory: [{
    email: { type: String },
    grantedAt: { type: Date },
    trialDurationDays: { type: Number }
  }],
  firstSeen: { 
    type: Date, 
    default: Date.now 
  },
  lastSeen: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
