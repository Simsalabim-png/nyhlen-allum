// Netlify Scheduled Functions cannot be invoked by a production URL. The schedule in netlify.toml is the guard.
const webpush = require('web-push');
const { getAdmin, subscriptionFrom } = require('./lib/security');

const TZ = 'Europe/Stockholm';
const WINDOW_MS = 15 * 60 * 1000;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const REM_TEXT = { 5: 'Om 5 minutter', 60: 'Om 1 time', 120: 'Om 2 timer', 1440: 'I morgen' };
const VALID_REPEATS = new Set(['ingen', 'daglig', 'ukentlig', 'manedlig', 'arlig']);
const VALID_REMINDERS = new Set([5, 60, 120, 1440]);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function validTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ''); }
function validEvent(event) {
  return Boolean(event && typeof event === 'object' && typeof event.title === 'string' && event.title.trim() && event.title.length <= 120 && validDate(event.date) && validTime(event.start) && VALID_REPEATS.has(event.repeat || 'ingen') && VALID_REMINDERS.has(Number(event.reminder)) && Array.isArray(event.members) && event.members.every((member) => typeof member === 'string' && member.length > 0 && member.length <= 80));
}

function localEpoch(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const part = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(guess)).find((value) => value.type === 'timeZoneName').value;
  const match = part.match(/([+-])(\d{2}):(\d{2})/);
  const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 120;
  return guess - offset * 60000;
}
function addDays(dateStr, days) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
function addMonths(dateStr, months) { const [y, m, d] = dateStr.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1 + months, 1)); const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(d, last)); return date.toISOString().slice(0, 10); }
function nextOccurrence(event, fromMs) {
  if (!validEvent(event)) return null;
  const repeat = { daglig: (i) => addDays(event.date, i), ukentlig: (i) => addDays(event.date, i * 7), manedlig: (i) => addMonths(event.date, i), arlig: (i) => addMonths(event.date, i * 12) }[event.repeat || 'ingen'];
  for (let i = 0; i < 2000; i++) { const date = repeat ? repeat(i) : (i === 0 ? event.date : null); if (!date) return null; if (localEpoch(date, event.start) >= fromMs) return date; }
  return null;
}
function configurePush(client, env) {
  if (!env.VAPID_PRIVATE_KEY) throw new Error('Push is unavailable');
  client.setVapidDetails('mailto:soahawaii@hotmail.com', 'BI_FvflusyLHju44Lig4k4Rlz2vR96lgSeyEHN8grfGxTxPuSHs8o61UsBwKTCNDboUWBITkQN_M4DgbQPn3_d8', env.VAPID_PRIVATE_KEY);
}
async function acquireClaim(ref, now) {
  const result = await ref.transaction((current) => {
    if (current && current.status === 'sent') return;
    if (current && current.status === 'processing' && now - Number(current.claimedAt || 0) < CLAIM_LEASE_MS) return;
    return { status: 'processing', claimedAt: now };
  });
  return result.committed;
}

exports.createHandler = (deps = {}) => async function handler() {
  const env = deps.env || process.env;
  if (!env.VAPID_PRIVATE_KEY) return { statusCode: 200, body: JSON.stringify({ checked: 0, sent: 0 }) };
  try {
    const sdk = deps.sdk || require('firebase-admin');
    const app = deps.app || getAdmin(env, sdk);
    const database = deps.database || sdk.database(app);
    const client = deps.webpush || webpush;
    configurePush(client, env);
    const now = deps.now ? deps.now() : Date.now();
    const [eventsSnapshot, devicesSnapshot] = await Promise.all([database.ref('events').once('value'), database.ref('pushDevices').once('value')]);
    const events = eventsSnapshot.val() && typeof eventsSnapshot.val() === 'object' ? eventsSnapshot.val() : {};
    const devices = devicesSnapshot.val() && typeof devicesSnapshot.val() === 'object' ? devicesSnapshot.val() : {};
    let checked = 0; let sent = 0;
    for (const [eventId, event] of Object.entries(events)) {
      if (!validEvent(event)) continue;
      const reminderMinutes = Number(event.reminder) || 0;
      if (!VALID_REMINDERS.has(reminderMinutes)) continue;
      checked++;
      const occurrence = nextOccurrence(event, now - WINDOW_MS);
      if (!occurrence) continue;
      const reminderAt = localEpoch(occurrence, event.start) - reminderMinutes * 60000;
      if (now < reminderAt || now - reminderAt > WINDOW_MS) continue;
      const members = Array.isArray(event.members) ? event.members : [];
      const notification = JSON.stringify({ notification: { title: '⏰ Påminnelse', body: `${REM_TEXT[reminderMinutes] || 'Snart'}: ${String(event.title || '').slice(0, 120)}${event.start ? ` kl. ${event.start}` : ''}` } });
      for (const [uid, ownerDevices] of Object.entries(devices)) {
        if ((await database.ref(`access/${uid}`).once('value')).val() !== true) continue;
        for (const [deviceId, device] of Object.entries(ownerDevices || {})) {
          if (!device || !device.subscription || (device.member && device.member !== 'Felles' && !members.includes(device.member))) continue;
          let subscription; try { subscription = subscriptionFrom(device.subscription); } catch (_) { continue; }
          const claim = database.ref(`reminderClaims/${eventId}/${occurrence}/${uid}/${deviceId}`);
          if (!(await acquireClaim(claim, now))) continue;
          // A provider success followed by a database failure is intentionally retried: delivery is at-least-once, never silently lost.
          try { await client.sendNotification(subscription, notification, { timeout: 10000 }); await claim.set({ status: 'sent', sentAt: now }); sent++; }
          catch (_) { await claim.remove(); }
        }
      }
    }
    return { statusCode: 200, body: JSON.stringify({ checked, sent }) };
  } catch (_) { return { statusCode: 500, body: JSON.stringify({ error: 'Reminder run failed' }) }; }
};
exports.handler = exports.createHandler();
exports.localEpoch = localEpoch;
exports.nextOccurrence = nextOccurrence;
exports.validEvent = validEvent;
