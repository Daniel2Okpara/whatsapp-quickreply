const crypto = require('crypto');
const Handshake = require('../models/handshake.model');
const User = require('../models/user.model');

function genToken(len = 8) {
  return crypto.randomBytes(Math.max(4, len)).toString('hex').slice(0, len);
}

exports.createHandshake = async (req, res) => {
  try {
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase() : null;
    if (!email) return res.status(400).json({ error: 'email_required' });
    const token = genToken(8);
    const expiresAt = new Date(Date.now() + (1000 * 60 * 15)); // 15 minutes
    const h = new Handshake({ token, email, expiresAt });
    await h.save();
    return res.json({ token, expiresAt });
  } catch (err) {
    console.error('[Handshake] create error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.consumeHandshake = async (req, res) => {
  try {
    const token = (req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token_required' });
    const rec = await Handshake.findOne({ token });
    if (!rec) return res.status(404).json({ error: 'not_found' });
    if (rec.used) return res.status(400).json({ error: 'token_used' });
    if (rec.expiresAt && rec.expiresAt < new Date()) return res.status(400).json({ error: 'token_expired' });

    // Mark used
    rec.used = true;
    await rec.save();

    // Ensure user exists
    let user = await User.findOne({ email: rec.email });
    if (!user) {
      user = new User({ email: rec.email, password: crypto.randomBytes(8).toString('hex') });
      await user.save();
    }

    return res.json({ email: rec.email });
  } catch (err) {
    console.error('[Handshake] consume error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
