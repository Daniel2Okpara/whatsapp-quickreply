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

exports.updateEmail = async (req, res) => {
  try {
    const { currentEmail, newEmail } = req.body || {};
    if (!currentEmail || !newEmail) return res.status(400).json({ error: 'current_and_new_email_required' });

    const cur = String(currentEmail).toLowerCase().trim();
    const nw = String(newEmail).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cur) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nw)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    const User = require('../models/user.model');
    const user = await User.findOne({ email: cur });
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    // Prevent collision with existing account
    const exists = await User.findOne({ email: nw });
    if (exists) return res.status(400).json({ error: 'email_already_in_use' });

    user.email = nw;
    await user.save();

    return res.json({ success: true, message: 'email_updated' });
  } catch (err) {
    console.error('[updateEmail] error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
