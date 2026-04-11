const User = require('../models/user.model');

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
