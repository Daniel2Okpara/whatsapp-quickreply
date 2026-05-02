const User = require('../models/user.model');
const WebhookLog = require('../models/webhook.model');
const paddleController = require('./paddle.controller');
const querystring = require('querystring');

exports.cancelSubscription = async (req, res) => {
  try {
    const { email, subscriptionId } = req.body || {};
    if (!email && !subscriptionId) return res.status(400).json({ error: 'email_or_subscriptionId_required' });

    let user = null;
    if (email) user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user && subscriptionId) user = await User.findOne({ subscriptionId: subscriptionId });
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    user.plan = 'free';
    user.subscriptionStatus = 'cancelled';
    user.subscriptionId = null;
    await user.save();

    return res.json({ success: true, message: 'subscription_cancelled' });
  } catch (err) {
    console.error('[Admin] cancelSubscription error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).limit(1000);
    return res.json({ users });
  } catch (err) {
    console.error('[Admin] listUsers error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.getUser = async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });
    const user = await User.findOne({ email }).select('-password');
    if (!user) return res.status(404).json({ error: 'not_found' });
    return res.json({ user });
  } catch (err) {
    console.error('[Admin] getUser error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.simulateWebhook = async (req, res) => {
  try {
    const { alert_name, email, subscription_id } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email_required' });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
       const crypto = require('crypto');
       user = new User({ email: email.toLowerCase(), password: crypto.randomBytes(8).toString('hex') });
    }

    if (alert_name === 'subscription_created' || alert_name === 'upgrade') {
      user.plan = 'pro';
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscription_id || `manual_${Date.now()}`;
    } else if (alert_name === 'subscription_activated' || alert_name === 'trial') {
      user.plan = 'trial';
      user.trialUsed = true;
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscription_id || `manual_${Date.now()}`;
      
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 3);
      user.trialEndsAt = trialEnds;
      user.trialEnd = trialEnds;
    } else if (alert_name === 'subscription_cancelled' || alert_name === 'cancel' || alert_name === 'downgrade') {
      user.plan = 'free';
      user.subscriptionStatus = 'cancelled';
      user.subscriptionId = null;
    }

    await user.save();

    // Notify extension via SSE
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, { 
        email: user.email, 
        plan: user.plan, 
        subscriptionId: user.subscriptionId, 
        subscriptionStatus: user.subscriptionStatus 
      });
      
      const { userCache } = require('./user.controller');
      if (userCache) userCache.del(user.email);
    } catch (e) {}

    return res.json({ success: true, user });
  } catch (err) {
    console.error('[Admin] simulateWebhook error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  // Prevent self-deletion
  if (req.user && req.user._id.toString() === userId.toString()) {
    return res.status(403).json({ error: 'Cannot delete your own administrative account.' });
  }

  try {
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

exports.promoteUser = async (req, res) => {
  const { email, secret } = req.body;
  if (!email || !secret) return res.status(400).json({ error: 'Email and secret required' });
  
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error('[Admin Security] ADMIN_SECRET not configured in environment variables.');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (secret === adminSecret) {
    try {
      const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { isAdmin: true }, { new: true });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({ message: 'User promoted correctly', user });
    } catch (e) {
      return res.status(500).json({ error: 'Database update failed' });
    }
  }
  return res.status(401).json({ error: 'Invalid secret' });
};

exports.updateAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findById(req.user._id);
    
    if (email) user.email = email;
    if (password) user.password = password; // Pre-save hook in user model handles hashing
    
    await user.save();
    return res.json({ success: true, message: 'Account updated successfully' });
  } catch (err) {
    console.error('[Admin] updateAdmin error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.listWebhookLogs = async (req, res) => {
  try {
    const { limit = 100, skip = 0 } = req.query;
    const logs = await WebhookLog.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .skip(parseInt(skip, 10));
    const total = await WebhookLog.countDocuments();
    return res.json({ logs, total });
  } catch (err) {
    console.error('[Admin] listWebhookLogs error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
