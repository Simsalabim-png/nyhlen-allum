import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// UI gating complements database rules and server verification; it grants no rights itself.
export function createFamilyAccess(app, db, { onOpen, onClose } = {}) {
  const auth = getAuth(app);
  const panel = document.getElementById('familyLogin');
  const content = document.getElementById('familyApp');
  const status = document.getElementById('familyLoginStatus');
  const form = document.getElementById('familyLoginForm');
  const logout = document.getElementById('familyLogout');
  const listeners = new Set();
  let allowed = false, stopAccess, generation = 0;

  function close(message) {
    allowed = false;
    for (const item of listeners) { item.stop?.(); item.stop = null; }
    content.hidden = true;
    content.inert = true;
    panel.hidden = false;
    status.textContent = message;
    logout.hidden = !auth.currentUser;
    onClose?.();
  }
  function start(item) {
    if (item.stop || !allowed) return;
    item.stop = onValue(item.target, snapshot => {
      if (allowed) item.callback(snapshot);
    }, () => close('Tilkoblingen ble avvist. Logg inn igjen, eller be om tilgang.'));
  }
  function open() {
    if (allowed) return;
    allowed = true;
    content.hidden = false;
    content.inert = false;
    panel.hidden = true;
    logout.hidden = false;
    for (const item of listeners) start(item);
    onOpen?.();
  }
  onAuthStateChanged(auth, user => {
    const current = ++generation;
    stopAccess?.();
    close(user ? 'Kontrollerer tilgangen …' : 'Logg inn med familiens godkjente konto.');
    form.hidden = !!user;
    if (!user) return;
    stopAccess = onValue(ref(db, 'access/' + user.uid), snapshot => {
      if (current !== generation) return;
      if (snapshot.val() === true) open();
      else close('Kontoen er innlogget, men mangler godkjent familietilgang.');
    }, () => {
      if (current === generation) close('Tilgangen kunne ikke kontrolleres. Prøv å logge inn igjen.');
    });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Logger inn …';
    try {
      await signInWithEmailAndPassword(auth, form.elements.email.value.trim(), form.elements.password.value);
      form.elements.password.value = '';
    } catch {
      status.textContent = 'Kunne ikke logge inn. Kontroller e-post og passord, og prøv igjen.';
    } finally { button.disabled = false; }
  });

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      // Stop this browser's push subscription when leaving a shared device.
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          if (allowed) await api('register-device', { endpoint: subscription.endpoint }, 'DELETE').catch(() => {});
          await subscription.unsubscribe();
        }
      }
    } catch { /* Sign-out must still be possible when offline. */ }
    finally {
      await signOut(auth);
      localStorage.removeItem('deviceMember');
      logout.disabled = false;
    }
  });

  async function api(name, body, method = 'POST') {
    if (!allowed || !auth.currentUser) throw new Error('Logg inn med en godkjent familiekonto.');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('/.netlify/functions/' + name, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) close('Tilgangen ble avvist. Logg inn igjen.');
      if (name === 'claude' && response.status === 503) throw new Error('Taleassistenten er midlertidig satt på pause. Du kan fortsatt legge inn hendelser og lister manuelt.');
      throw new Error(response.status === 429 ? 'For mange forespørsler. Prøv igjen litt senere.' : 'Tjenesten svarte ikke som forventet. Prøv igjen.');
    }
    return response;
  }
  return {
    api,
    get allowed() { return allowed; },
    listen(target, callback) {
      const item = { target, callback, stop: null };
      listeners.add(item);
      start(item);
      return () => { item.stop?.(); listeners.delete(item); };
    }
  };
}
