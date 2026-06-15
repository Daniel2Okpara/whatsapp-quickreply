const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  emailsUsed: [{ 
    type: String 
  }], // All emails that have authenticated on this device
  trialUsed: { 
    type: Boolean, 
    default: false 
  }, // PERMANENT FLAG
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
