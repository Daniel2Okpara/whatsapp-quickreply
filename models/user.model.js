const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  password: {
    type: String,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String,
    default: null
  },
  verificationExpires: {
    type: Date,
    default: null
  },
  isPro: {
    type: Boolean,
    default: false
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'trial'],
    default: 'free'
  },
  trialUsed: {
    type: Boolean,
    default: false
  },
  paddleCustomerId: {
    type: String,
    default: null
  },
  paddleSubscriptionId: {
    type: String,
    default: null
  },
  subscriptionId: { // Keeping legacy for backward compatibility
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'cancelled', 'inactive', 'past_due', 'paused'],
    default: 'inactive'
  },
  trialEndsAt: {
    type: Date,
    default: null
  },
  creditsUsed: {
    type: Number,
    default: 0
  },
  dailyUsage: {
    type: Number,
    default: 0
  },
  lastUsageReset: {
    type: Date,
    default: Date.now
  },
  templates: [
    {
      _id: { type: String },
      text: { type: String, required: true },
      category: { type: String, default: 'General' },
      createdAt: { type: Date, default: Date.now }
    }
  ],
  lastLogin: {
    type: Date,
    default: Date.now
  },
  emailHistory: [
    {
      oldEmail: String,
      newEmail: String,
      changedAt: { type: Date, default: Date.now }
    }
  ]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare hashed password for login
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
