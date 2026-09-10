const crypto = require('crypto');
const firebaseAdmin = require('firebase-admin');

const PROJECT_ID = 'nyhlen-allum';
let app;

function publicError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }

function getAdmin(env = process.env, sdk = firebaseAdmin) {
  if (app) return app;
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT || ''); }
  catch (_) { throw publicError(500, 'Server configuration is unavailable'); }
  if (!serviceAccount || serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) throw publicError(500, 'Server configuration is unavailable');
  app = sdk.apps && sdk.apps.length ? sdk.app() : sdk.initializeApp({
    credential: sdk.credential.cert(serviceAccount),
    databaseURL: `https://${PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app`
  });
  return app;
}

function getBearer(event) {
  const headers = event.headers || {};
  const match = /^Bearer\s+(.{20,})$/.exec(headers.authorization || headers.Authorization || '');
  if (!match) throw publicError(401, 'Authentication is required');
  return match[1];
}

async function authorizeMember(event, deps = {}) {
  const token = getBearer(event);
  const sdk = deps.sdk || firebaseAdmin;
  const firebaseApp = deps.app || getAdmin(deps.env || process.env, sdk);
  let decoded;
  try { decoded = await sdk.auth(firebaseApp).verifyIdToken(token, true); }
  catch (error) { if (error.statusCode) throw error; throw publicError(401, 'Authentication is required'); }
  const database = deps.database || sdk.database(firebaseApp);
  const member = await database.ref(`access/${decoded.uid}`).once('value');
  if (member.val() !== true) throw publicError(403, 'Access is not permitted');
  return { uid: decoded.uid, database };
}

function jsonBody(event, maxBytes = 8192) {
  if (typeof event.body !== 'string' || Buffer.byteLength(event.body, 'utf8') > maxBytes) throw publicError(400, 'Invalid request');
  try { return JSON.parse(event.body); } catch (_) { throw publicError(400, 'Invalid request'); }
}
function text(value, max) { if (typeof value !== 'string') return null; const valueTrimmed = value.trim(); return valueTrimmed && valueTrimmed.length <= max ? valueTrimmed : null; }
function response(statusCode, body) { return { statusCode, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: body === undefined ? '' : JSON.stringify(body) }; }
function fail(error) { return response(error.statusCode || 500, { error: error.statusCode ? error.message : 'Request failed' }); }

async function enforceRateLimit(database, action, uid, limit, windowMs, now = Date.now()) {
  const result = await database.ref(`security/rateLimits/${action}/${uid}`).transaction((current) => {
    const inWindow = current && typeof current.windowStart === 'number' && now - current.windowStart < windowMs;
    const count = inWindow ? Number(current.count || 0) : 0;
    if (count >= limit) return;
    return { windowStart: inWindow ? current.windowStart : now, count: count + 1, updatedAt: now };
  });
  if (!result.committed) throw publicError(429, 'Too many requests');
}

function validatedEndpoint(value) {
  const endpoint = typeof value === 'string' ? value : '';
  let url; try { url = new URL(endpoint); } catch (_) { throw publicError(400, 'Invalid subscription'); }
  const allowedHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  const authority = endpoint.slice('https://'.length).split(/[/?#]/, 1)[0];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || authority.includes(':') || !allowedHosts.includes(url.hostname) || endpoint.length > 2048) throw publicError(400, 'Invalid subscription');
  return endpoint;
}

function subscriptionFrom(input) {
  const subscription = input && typeof input === 'object' ? input : null;
  const endpoint = validatedEndpoint(subscription && subscription.endpoint);
  const base64Url = /^[A-Za-z0-9_-]+$/;
  if (!subscription.keys || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string' || !base64Url.test(subscription.keys.p256dh) || !base64Url.test(subscription.keys.auth) || subscription.keys.p256dh.length < 80 || subscription.keys.p256dh.length > 120 || subscription.keys.auth.length < 16 || subscription.keys.auth.length > 64) throw publicError(400, 'Invalid subscription');
  return { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
}
function endpointHash(endpoint) { return crypto.createHash('sha256').update(endpoint).digest('hex'); }

module.exports = { PROJECT_ID, publicError, getAdmin, authorizeMember, jsonBody, text, response, fail, enforceRateLimit, validatedEndpoint, subscriptionFrom, endpointHash };
