const User = require('../models/user.model');
const NodeCache = require('node-cache');
const userCache = new NodeCache({ stdTTL: 120 }); // 2 minute TTL

exports.userCache = userCache;

exports.getUserStatus = async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });

    let user = await User.findOne({ email });
    let cachedUser = userCache.get(email);
    
    if (cachedUser) return res.json(cachedUser);

    if (!user) {
      // Return a guest status instead of creating a user automatically without verification
      return res.json({ 
        plan: 'free', 
        status: 'inactive', 
        verified: false,
        requiresRegistration: true 
      });
    }

    let plan = user.plan || 'free';
    const status = (user.subscriptionStatus === 'active') ? 'active' : 'inactive';
    const trialEnd = user.trialEndsAt || user.trialEnd;

    if (plan === 'trial' && trialEnd && new Date() > new Date(trialEnd)) {
      plan = 'free';
    }

    const result = { 
      _id: user._id,
      email: user.email,
      plan, 
      status, 
      isPro: user.isPro || plan === 'pro',
      verified: user.verified,
      trialEndsAt: trialEnd,
      totalCreditsUsed: user.creditsUsed || 0
    };
    
    userCache.set(email, result);
    return res.json(result);
  } catch (err) {
    console.error('[UserStatus] error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
