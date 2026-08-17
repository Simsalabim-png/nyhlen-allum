// Kjøres automatisk hvert 5. minutt (schedule i netlify.toml).
// Sjekker alle hendelser med påminnelse og sender push til deltakernes enheter.
const webpush = require('web-push');

const DB = 'https://nyhlen-allum-default-rtdb.europe-west1.firebasedatabase.app';
const TZ = 'Europe/Stockholm';
const WINDOW_MS = 15 * 60 * 1000; // send hvis påminnelsestidspunktet var innenfor siste 15 min

webpush.setVapidDetails(
  'mailto:soahawaii@hotmail.com',
  'BI_FvflusyLHju44Lig4k4Rlz2vR96lgSeyEHN8grfGxTxPuSHs8o61UsBwKTCNDboUWBITkQN_M4DgbQPn3_d8',
  process.env.VAPID_PRIVATE_KEY
);

// Epoch (ms) for "YYYY-MM-DD" + "HH:MM" i svensk/norsk tid
function localEpoch(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const part = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(guess)).find(p => p.type === 'timeZoneName').value; // "GMT+02:00"
  const mt = part.match(/([+-])(\d{2}):(\d{2})/);
  const offMin = mt ? (mt[1] === '-' ? -1 : 1) * (Number(mt[2]) * 60 + Number(mt[3])) : 120;
  return guess - offMin * 60000;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

// Neste forekomst (dato-streng) hvis starttidspunkt >= fra-tidspunkt.
// Regner alltid fra original startdato (i-te forekomst) så f.eks. "31. hver måned" ikke skrumper etter februar.
function nextOccurrence(ev, fromMs) {
  if (!ev.date) return null;
  const nth = { daglig: i => addDays(ev.date, i), ukentlig: i => addDays(ev.date, i * 7), manedlig: i => addMonths(ev.date, i), arlig: i => addMonths(ev.date, i * 12) }[ev.repeat];
  for (let i = 0; i < 2000; i++) {
    const d = nth ? nth(i) : (i === 0 ? ev.date : null);
    if (!d) return null; // engangs-hendelse som allerede har vært
    if (localEpoch(d, ev.start) >= fromMs) return d;
  }
  return null;
}

const REM_TEXT = { 5: 'Om 5 minutter', 60: 'Om 1 time', 120: 'Om 2 timer', 1440: 'I morgen' };

exports.handler = async function () {
  const now = Date.now();
  const [events, tokens] = await Promise.all([
    fetch(DB + '/events.json').then(r => r.json()),
    fetch(DB + '/pushTokens.json').then(r => r.json())
  ]);
  const devices = Object.values(tokens || {}).filter(t => t && t.token);
  let checked = 0, sent = 0;

  for (const [id, ev] of Object.entries(events || {})) {
    const remMin = Number(ev.reminder) || 0;
    if (!remMin) continue;
    checked++;
    const occ = nextOccurrence(ev, now - WINDOW_MS);
    if (!occ) continue;
    const startMs = localEpoch(occ, ev.start);
    const remAt = startMs - remMin * 60000;
    if (now < remAt || now - remAt > WINDOW_MS) continue;      // ikke tid ennå / for gammelt
    if (ev.remindedFor === occ) continue;                       // allerede sendt for denne forekomsten

    // Marker som sendt FØR utsending (unngå dobbelt ved parallelle kjøringer)
    await fetch(DB + '/events/' + id + '.json', { method: 'PATCH', body: JSON.stringify({ remindedFor: occ }) });

    const members = Array.isArray(ev.members) ? ev.members : [];
    const targets = devices.filter(t => !t.member || t.member === 'Felles' || members.includes(t.member));
    const when = REM_TEXT[remMin] || 'Snart';
    const time = ev.start ? ' kl. ' + ev.start : '';
    const payload = JSON.stringify({ notification: {
      title: '⏰ Påminnelse',
      body: `${when}: ${ev.title}${time}` + (members.length && members.length < 4 ? ` (${members.join(', ')})` : '')
    }});
    for (const t of targets) {
      try { await webpush.sendNotification(JSON.parse(t.token), payload); sent++; }
      catch (e) { console.log('Reminder send failed:', e.statusCode, e.message); }
    }
    console.log('Reminder sent for', ev.title, occ, '→', targets.length, 'devices');
  }
  console.log('Reminders run: checked', checked, 'sent', sent);
  return { statusCode: 200, body: JSON.stringify({ checked, sent }) };
};
