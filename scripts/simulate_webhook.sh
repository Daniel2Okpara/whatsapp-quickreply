#!/usr/bin/env bash
# Usage: PADDLE_WEBHOOK_SECRET=secret ./simulate_webhook.sh
HOST=${1:-http://localhost:3000}
ALERT=${2:-subscription_created}
EMAIL=${3:-test@example.com}
SUB=${4:-sub_test_123}

BODY="alert_name=${ALERT}&email=${EMAIL}&subscription_id=${SUB}"
SIG=${PADDLE_WEBHOOK_SECRET:+$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$PADDLE_WEBHOOK_SECRET" -hex | sed 's/^.* //')}

curl -i -X POST "$HOST/webhook/paddle" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  ${SIG:+-H "x-paddle-signature: $SIG"} \
  --data "$BODY"
