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
    // Protected admin route should ensure only admins call this
    const { alert_name, email, subscription_id, extra } = req.body || {};
    if (!alert_name || !email) return res.status(400).json({ error: 'alert_name_and_email_required' });

    // Build a payload similar to Paddle form post
    const body = Object.assign({}, extra || {}, { alert_name, email, subscription_id });
    const raw = querystring.stringify(body);

    const result = await paddleController.processPaddlePayload(body, raw);
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Admin] simulateWebhook error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    
    return res.json({ success: true, message: 'userDeleted' });
  } catch (err) {
    console.error('[Admin] deleteUser error', err);
    return res.status(500).json({ error: 'server_error' });
  }
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
