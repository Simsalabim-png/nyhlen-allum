self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.notification?.title || 'Nyhlen Allum';
  const body = data.notification?.body || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.png',
      badge: '/icon.png',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
