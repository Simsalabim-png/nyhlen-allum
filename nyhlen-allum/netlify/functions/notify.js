const { GoogleAuth } = require('google-auth-library');

const VAPID_KEY = 'BI3KTiYqwWSf4-TyNK7rJ0XW2UVRnEQIDKH9u5Vb_qdTC0o83jcK5ura3JecBxoJYOL0ZHuxuLShq6-L8593dMs';
const PROJECT_ID = 'nyhlen-allum';
const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

async function getAccessToken() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body);
    const { tokens, title, body: msgBody } = body;

    if (!tokens || tokens.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0 }) };
    }

    const accessToken = await getAccessToken();
    let sent = 0;

    for (const token of tokens) {
      try {
        const res = await fetch(FCM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body: msgBody },
              webpush: {
                notification: { title, body: msgBody, icon: '/icon.png' }
              }
            }
          })
        });
        if (res.ok) sent++;
      } catch(e) { console.log('Token failed:', e.message); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ sent }) };
  } catch(err) {
    console.log('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
