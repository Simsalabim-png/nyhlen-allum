const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:soahawaii@hotmail.com',
  'BI_FvflusyLHju44Lig4k4Rlz2vR96lgSeyEHN8grfGxTxPuSHs8o61UsBwKTCNDboUWBITkQN_M4DgbQPn3_d8',
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { tokens, title, body } = JSON.parse(event.body);
    console.log('Received request - tokens:', tokens ? tokens.length : 0, 'title:', title);
    if (!tokens || tokens.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ sent: 0 }) };

    const payload = JSON.stringify({ notification: { title, body } });
    let sent = 0;
    let errors = [];
    for (const tokenStr of tokens) {
      try {
        const subscription = JSON.parse(tokenStr);
        await webpush.sendNotification(subscription, payload);
        sent++;
        console.log('Sent OK to:', subscription.endpoint.substring(0, 50));
      } catch(e) { 
        console.log('Failed:', e.statusCode, e.message); 
        errors.push(e.message);
      }
    }
    console.log('Total sent:', sent, 'errors:', errors.length);
    return { statusCode: 200, headers, body: JSON.stringify({ sent, errors }) };
  } catch(err) {
    console.log('Handler error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
