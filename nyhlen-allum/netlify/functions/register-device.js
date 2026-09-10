const { authorizeMember, jsonBody, text, response, fail, validatedEndpoint, subscriptionFrom, endpointHash } = require('./lib/security');

exports.createHandler = (deps = {}) => async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204);
  if (!['POST', 'DELETE'].includes(event.httpMethod)) return response(405, { error: 'Method not allowed' });
  try {
    const { uid, database } = await authorizeMember(event, deps);
    const body = jsonBody(event, 4096);
    if (event.httpMethod === 'DELETE') {
      const endpoint = validatedEndpoint(body.endpoint || (body.subscription && body.subscription.endpoint));
      await database.ref(`pushDevices/${uid}/${endpointHash(endpoint)}`).remove();
      return response(204);
    }
    const subscription = subscriptionFrom(body.subscription || body);
    const key = endpointHash(subscription.endpoint);
    const ref = database.ref(`pushDevices/${uid}/${key}`);
    const member = text(body.member, 80) || 'Felles';
    if (member !== 'Felles') {
      const members = (await database.ref('members').once('value')).val();
      if (!members || typeof members !== 'object' || !Object.prototype.hasOwnProperty.call(members, member)) return response(400, { error: 'Invalid member' });
    }
    await ref.set({ subscription, member, updatedAt: Date.now() });
    return response(201, { registered: true });
  } catch (error) { return fail(error); }
};
exports.handler = exports.createHandler();
