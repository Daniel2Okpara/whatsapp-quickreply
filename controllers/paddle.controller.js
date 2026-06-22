const crypto = require('crypto');
const querystring = require('querystring');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const WebhookLog = require('../models/webhook.model');
const eventsService = require('../services/events.service');

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

exports.processPaddlePayload = async (body, raw) => {
  const alertName = body.alert_name || body.alert || body.event_type || '';
  const eventId = body.event_id || body.id || null;
  const rawHash = crypto.createHash('sha256').update(raw || '').digest('hex');

  // 1. Idempotency Check
  let log = await WebhookLog.findOne({ $or: [{ eventId: eventId }, { hash: rawHash }] });
  
  if (log && log.isProcessed) {
    console.log(`[Paddle] Duplicate event skipped: ${eventId || rawHash}`);
    return { status: 'duplicate' };
  }

  if (!log) {
    log = new WebhookLog({ 
      eventId, 
      hash: rawHash, 
      alertName, 
      subscriptionId: body.subscription_id || body.subscription || null,
      rawBody: raw, 
      status: 'processing' 
    });
    await log.save();
  } else {
    log.attempts += 1;
    await log.save();
  }

  // 2. Respond HTTP 200 immediately (handled by the caller handleWebhook)
  // 3. Process Async
  process.nextTick(() => {
    executeWebhookLogic(body, log).catch(err => {
      console.error('[Paddle] Async processing error:', err);
    });
  });

  return { status: 'queued', eventId };
};

const executeWebhookLogic = async (body, log) => {
  const alertName = body.alert_name || body.alert || body.event_type || '';
  const email = (body.email || body.customer_email || body.data?.customer?.email || '').toLowerCase();
  const subscriptionId = body.subscription_id || body.subscription || body.subscription_id_external || body.data?.id || null;
  const paddleCustomerId = body.customer_id || body.user_id || body.data?.customer?.id || null;
  
  let userId = null;
  if (body.data && body.data.custom_data && body.data.custom_data.userId) {
    userId = body.data.custom_data.userId;
  } else if (body.passthrough) {
    try {
      const passthrough = JSON.parse(body.passthrough);
      if (passthrough.userId) userId = passthrough.userId;
    } catch (e) {
      if (mongoose.Types.ObjectId.isValid(body.passthrough)) userId = body.passthrough;
    }
  }

  let user = null;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    user = await User.findById(userId);
  }
  
  if (!user && email) {
    user = await User.findOne({ email });
  }

  if (!user) {
    if (email) {
      user = new User({ email, password: crypto.randomBytes(16).toString('hex'), verified: true });
    } else {
      log.status = 'ignored (no user)';
      await log.save();
      return;
    }
  }

  // Update IDs
  if (paddleCustomerId) user.paddleCustomerId = paddleCustomerId;
  if (subscriptionId) user.paddleSubscriptionId = subscriptionId;

  const isActivation = alertName.includes('subscription.created') || 
                       alertName.includes('subscription.activated') || 
                       alertName.includes('subscription_created') || 
                       alertName.includes('subscription_activated');
                       
  const isCancellation = alertName.includes('subscription.canceled') || 
                         alertName.includes('subscription_cancelled') ||
                         alertName.includes('subscription.deleted');

  const isPayment = alertName.includes('transaction.paid') || 
                    alertName.includes('subscription_payment_succeeded') ||
                    alertName.includes('transaction.completed');

  // Check if plan was manually changed by admin recently (within last 24 hours)
  // If so, skip webhook processing to prevent override
  const manualChangeThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  if (user.planChangedManuallyAt && user.planChangedBy === 'admin' && user.planChangedManuallyAt > manualChangeThreshold) {
    console.log(`[Paddle] Skipping webhook for ${user.email} - plan was manually changed by admin less than 24 hours ago`);
    log.status = 'skipped (manual override)';
    log.isProcessed = true;
    log.processedAt = new Date();
    await log.save();
    return;
  }

  if (isActivation || isPayment) {
    user.plan = 'pro';
    user.subscriptionStatus = 'active';
    user.isPro = true;
    user.planChangedManuallyAt = null; // Clear manual flag on webhook activation
    user.planChangedBy = 'webhook';
  }

  if (isCancellation) {
    user.plan = 'free';
    user.subscriptionStatus = 'cancelled';
    user.isPro = false;
    user.planChangedManuallyAt = null; // Clear manual flag on webhook cancellation
    user.planChangedBy = 'webhook';
  }

  await user.save();
  
  log.status = 'done';
  log.isProcessed = true;
  log.processedAt = new Date();
  await log.save();

  // Notify SSE
  try {
    const eventsService = require('../services/events.service');
    eventsService.notifyEmail(user.email, { 
      userId: user._id,
      email: user.email, 
      plan: user.plan, 
      subscriptionStatus: user.subscriptionStatus,
      isPro: user.isPro
    });
  } catch (e) {}
};

exports.handleWebhook = async (req, res) => {
  const raw = req.body.raw; // Assuming middleware provides raw body
  const body = req.body;
  
  try {
    const result = await exports.processPaddlePayload(body, JSON.stringify(body));
    // Respond 200 immediately
    return res.status(200).json({ status: 'ok', eventId: result.eventId });
  } catch (err) {
    console.error('[Paddle] Webhook Error:', err);
    return res.status(200).json({ status: 'error_logged' }); // Still 200 for Paddle
  }
};

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
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.error('[Paddle Security] PADDLE_WEBHOOK_SECRET is missing. Rejecting webhook.');
    return res.status(500).send('Server configuration error');
  }

  const ok = verifyWebhookHmac(req);
  if (!ok) {
    console.warn('[Paddle Security] Webhook signature verification failed. Rejecting.');
    return res.status(400).send('invalid signature');
  }

  try {
    const result = await exports.processPaddlePayload(body, raw);
    return res.status(200).send(result.status || 'ok');
  } catch (err) {
    console.error('[Paddle] webhook handling error', err);
    try {
      await WebhookLog.create({ hash: crypto.createHash('sha256').update(raw).digest('hex'), alertName: body.alert_name || body.alert, subscriptionId: body.subscription_id || null, rawBody: raw, status: 'failed' });
    } catch (e) {}
    return res.status(500).send('error');
  }
};

exports.getCustomerPortalUrl = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.paddleCustomerId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Generate customer portal URL using Paddle API
    const paddleApiKey = process.env.PADDLE_API_KEY;
    if (!paddleApiKey) {
      return res.status(500).json({ error: 'Paddle API key not configured' });
    }

    const response = await fetch('https://api.paddle.com/customer-portal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paddleApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer_id: user.paddleCustomerId,
        return_url: 'https://www.wa-quick-reply.com/#pricing'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Paddle] Failed to generate customer portal URL:', error);
      return res.status(500).json({ error: 'Failed to generate customer portal URL' });
    }

    const data = await response.json();
    return res.json({ url: data.url });
  } catch (err) {
    console.error('[Paddle] getCustomerPortalUrl error:', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};
