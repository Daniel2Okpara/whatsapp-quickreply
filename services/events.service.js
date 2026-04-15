const clients = new Map(); // email -> Set(res)

function addClient(email, res) {
  if (!email) return;
  let set = clients.get(email);
  if (!set) {
    set = new Set();
    clients.set(email, set);
  }
  set.add(res);
}

function removeClient(email, res) {
  const set = clients.get(email);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(email);
}

function sendEvent(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // ignore
  }
}

function notifyEmail(email, data) {
  const set = clients.get(email);
  if (!set) return 0;
  for (const res of set) {
    sendEvent(res, 'subscription_update', data);
  }
  return set.size;
}

module.exports = { addClient, removeClient, notifyEmail };
