const webpush = require('web-push');
const { authorizeMember, jsonBody, text, response, fail, enforceRateLimit, subscriptionFrom } = require('./lib/security');

function configurePush(client = webpush, env = process.env) {
  if (!env.VAPID_PRIVATE_KEY) throw new Error('Push is unavailable');
  client.setVapidDetails('mailto:soahawaii@hotmail.com', 'BI_FvflusyLHju44Lig4k4Rlz2vR96lgSeyEHN8grfGxTxPuSHs8o61UsBwKTCNDboUWBITkQN_M4DgbQPn3_d8', env.VAPID_PRIVATE_KEY);
  return client;
}

exports.createHandler = (deps = {}) => async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204);
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  try {
    const { uid, database } = await authorizeMember(event, deps);
    const body = jsonBody(event, 2048);
    const title = text(body.title, 120);
    const message = text(body.body, 500);
    if (!title || !message) return response(400, { error: 'Invalid notification' });
    await enforceRateLimit(database, 'notify', uid, 10, 60 * 60 * 1000, deps.now ? deps.now() : Date.now());
    const devices = (await database.ref('pushDevices').once('value')).val() || {};
    const client = configurePush(deps.webpush || webpush, deps.env || process.env);
    const payload = JSON.stringify({ notification: { title, body: message } });
    let attempted = 0; let sent = 0; let failed = 0;
    for (const [ownerUid, ownerDevices] of Object.entries(devices)) {
      if ((await database.ref(`access/${ownerUid}`).once('value')).val() !== true) continue;
      for (const device of Object.values(ownerDevices || {})) {
        if (!device || !device.subscription) continue;
        attempted++;
        try { await client.sendNotification(subscriptionFrom(device.subscription), payload, { timeout: 10000 }); sent++; }
        catch (_) { failed++; /* Push providers may reject expired subscriptions; do not expose details. */ }
      }
    }
    return response(attempted > 0 && sent === 0 ? 502 : 200, { sent, failed });
  } catch (error) { return fail(error); }
};
exports.handler = exports.createHandler();
