const { authorizeMember, jsonBody, response, fail, enforceRateLimit } = require('./lib/security');

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) return false;
  let total = 0;
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) return false;
    total += message.content.length;
  }
  return total <= 12000;
}

// AI is deliberately fail-closed until a separate decision approves a paid external provider.
exports.createHandler = (deps = {}) => async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204);
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  try {
    const { uid, database } = await authorizeMember(event, deps);
    const body = jsonBody(event, 14000);
    if (!validMessages(body.messages)) return response(400, { error: 'Invalid request' });
    await enforceRateLimit(database, 'ai', uid, 20, 60 * 60 * 1000, deps.now ? deps.now() : Date.now());
    return response(503, { error: 'AI is unavailable' });
  } catch (error) { return fail(error); }
};
exports.handler = exports.createHandler();
exports.validMessages = validMessages;
