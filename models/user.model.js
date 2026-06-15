const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String, required: true, unique: true, trim: true, lowercase: true, index: true
  },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
  verificationToken: { type: String, default: null },
  verificationExpires: { type: Date, default: null },
  pendingEmail: { type: String, default: null },
  pendingEmailToken: { type: String, default: null },
  pendingEmailExpires: { type: Date, default: null },
  isPro: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  // RBAC
  role: { type: String, enum: ['user', 'admin', 'super_admin'], default: 'user' },
  adminStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  adminRequestedAt: { type: Date, default: null },
  
  // Trial and Subscription Management
  plan: { type: String, enum: ['free', 'pro', 'trial'], default: 'free' },
  trialUsed: { type: Boolean, default: false }, // Permanent flag - NEVER reset
  trialActive: { type: Boolean, default: false },
  trialStartedAt: { type: Date, default: null },
  trialEndsAt: { type: Date, default: null },
  trialDurationDays: { type: Number, default: 3 }, // Configurable trial duration
  
  // Subscription Management
  subscriptionStatus: {
    type: String, enum: ['active', 'cancelled', 'inactive', 'past_due', 'paused', 'expired'], default: 'inactive'
  },
  subscriptionStartedAt: { type: Date, default: null },
  subscriptionEndsAt: { type: Date, default: null },
  subscriptionCancelledAt: { type: Date, default: null },
  subscriptionPlan: { type: String, default: null }, // 'monthly', 'yearly', etc.
  
  // Payment Provider Integration
  paddleCustomerId: { type: String, default: null },
  paddleSubscriptionId: { type: String, default: null },
  subscriptionId: { type: String, default: null },
  
  // Usage Tracking
  creditsUsed: { type: Number, default: 0 },
  dailyUsage: { type: Number, default: 0 },
  lastUsageReset: { type: Date, default: Date.now },
  
  // Feature Flags
  features: {
    styleLearning: { type: Boolean, default: true },
    autoFollowUp: { type: Boolean, default: true },
    aiReply: { type: Boolean, default: true },
    improveMessage: { type: Boolean, default: true }
  },
  
  // Templates
  templates: [{
    _id: { type: String },
    text: { type: String, required: true },
    category: { type: String, default: 'General' },
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Account Activity
  lastLogin: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  accountStatus: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  
  // Device Management
  devices: [{
    deviceId: { type: String, required: true },
    deviceName: { type: String, default: null },
    platform: { type: String, default: null },
    lastSeen: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
  }],
  
  // Email History for audit trail
  emailHistory: [{
    oldEmail: String,
    newEmail: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String, enum: ['user', 'admin', 'system'], default: 'user' }
  }],
  
  // Style Learning Data
  styleLearningData: [{
    context: String,
    exampleMessage: String,
    tone: String,
    recordedAt: { type: Date, default: Date.now }
  }],
  
  // Fraud Prevention
  fraudFlags: {
    multipleTrialAttempts: { type: Boolean, default: false },
    suspiciousActivity: { type: Boolean, default: false },
    flaggedAt: { type: Date, default: null },
    flagReason: { type: String, default: null }
  },
  
  // Metadata
  metadata: {
    source: { type: String, enum: ['extension', 'web', 'api'], default: 'extension' },
    referrer: { type: String, default: null },
    utmSource: { type: String, default: null },
    utmMedium: { type: String, default: null },
    utmCampaign: { type: String, default: null }
  }
}, { timestamps: true });

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ trialUsed: 1 });
userSchema.index({ subscriptionStatus: 1 });
userSchema.index({ accountStatus: 1 });
userSchema.index({ 'devices.deviceId': 1 });
userSchema.index({ createdAt: -1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
