const User = require('../models/user.model');

exports.getUserStatus = async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });

    const user = await User.findOne({ email });
    if (!user) return res.json({ plan: 'free', status: 'inactive' });

    const plan = user.plan || (user.isPro ? 'pro' : 'free');
    const status = (user.subscriptionStatus === 'active') ? 'active' : 'inactive';

    return res.json({ plan, status });
  } catch (err) {
    console.error('[UserStatus] error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
