const crypto = require('crypto');
const querystring = require('querystring');
const User = require('../models/user.model');
const WebhookLog = require('../models/webhook.model');

// HMAC verification using PADDLE_WEBHOOK_SECRET
function verifyWebhookHmac(req) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return false;
  const sigHeader = req.headers['x-paddle-signature'] || req.headers['paddle-signature'] || req.headers['p-signature'];
  if (!sigHeader) return false;
  const raw = req.rawBody || '';
  const hmac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sigHeader));
  } catch (e) {
    return false;
  }
}

exports.handleWebhook = async (req, res) => {
  // Read rawBody and parse form data
  const raw = req.rawBody ? req.rawBody.toString() : '';
  let body = {};
  try {
    body = querystring.parse(raw);
  } catch (e) {
    console.warn('[Paddle] Failed to parse webhook body', e);
  }

  // Verify webhook using HMAC secret (Paddle Billing)
  if (process.env.PADDLE_WEBHOOK_SECRET) {
    const ok = verifyWebhookHmac(req);
    if (!ok) {
      console.warn('[Paddle] Webhook signature verification failed');
      return res.status(400).send('invalid signature');
    }
  }

  const alertName = body.alert_name || body.alert || '';
  const email = (body.email || '').toLowerCase();
  const subscriptionId = body.subscription_id || body.subscription || body.subscription_id_external || null;

  console.log('[Paddle] Received webhook:', alertName, 'for', email);

  try {
    if (!email) {
      return res.status(200).send('no-email');
    }

    // Deduplicate using raw body hash
    const rawHash = crypto.createHash('sha256').update(raw).digest('hex');
    const existingLog = await WebhookLog.findOne({ hash: rawHash });
    if (existingLog) {
      existingLog.attempts = (existingLog.attempts || 1) + 1;
      existingLog.processedAt = new Date();
      await existingLog.save();
      console.log('[Paddle] Duplicate webhook received, incremented attempts');
      return res.status(200).send('duplicate');
    }

    // Create log entry
    const log = new WebhookLog({ hash: rawHash, alertName: alertName, subscriptionId, rawBody: raw, status: 'processing' });
    await log.save();

    let user = await User.findOne({ email });
    if (!user) {
      // Create a user record for tracking
      user = new User({ email, password: crypto.randomBytes(8).toString('hex') });
    }

    if (alertName.includes('subscription_created') || alertName.includes('subscription.created') || alertName === 'subscription.created') {
      user.plan = 'pro';
      user.subscriptionId = subscriptionId;
      user.subscriptionStatus = 'active';
    }

    if (alertName.includes('subscription_activated') || alertName.includes('subscription.activated')) {
      user.plan = 'pro';
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscriptionId || user.subscriptionId;
    }

    if (alertName.includes('subscription_cancelled') || alertName.includes('subscription.cancelled') || alertName === 'subscription.cancelled') {
      user.plan = 'free';
      user.subscriptionStatus = 'cancelled';
      user.subscriptionId = subscriptionId || user.subscriptionId;
    }

    if (alertName.includes('subscription_payment_succeeded') || alertName.includes('subscription.payment_succeeded')) {
      user.plan = 'pro';
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscriptionId || user.subscriptionId;
    }

    await user.save();
    log.status = 'done';
    log.processedAt = new Date();
    await log.save();
    return res.status(200).send('ok');
  } catch (err) {
    console.error('[Paddle] webhook handling error', err);
    try {
      await WebhookLog.create({ hash: crypto.createHash('sha256').update(raw).digest('hex'), alertName, subscriptionId, rawBody: raw, status: 'failed' });
    } catch (e) {}
    return res.status(500).send('error');
  }
};
