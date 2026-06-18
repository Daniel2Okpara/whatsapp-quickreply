// Node helper to simulate a Paddle webhook POST with computed HMAC header
const crypto = require('crypto');
const querystring = require('querystring');
const https = require('https');
const http = require('http');

const rawArgs = process.argv.slice(2);
const args = rawArgs.reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key && value !== undefined) {
    acc[key.replace(/^--/, '')] = value;
  }
  return acc;
}, {});
const host = args.host || 'http://localhost:3000';
const path = args.path || '/webhook/paddle';
const email = args.email || 'test@example.com';
const alert_name = args.alert || 'subscription_created';
const subscription_id = args.subscription || 'sub_test_123';
const secret = process.env.PADDLE_WEBHOOK_SECRET || args.secret;

const body = querystring.stringify({ alert_name, email, subscription_id });
const isHttps = host.startsWith('https://');

const signature = secret ? crypto.createHmac('sha256', secret).update(body).digest('hex') : '';

const url = new URL(path, host);
const opts = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
  }
};
if (signature) opts.headers['x-paddle-signature'] = signature;

const lib = isHttps ? https : http;
const req = lib.request(opts, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response:', res.statusCode, data.toString());
  });
});
req.on('error', (err) => console.error('Request error', err));
req.write(body);
req.end();

