// SW desactivado - solo existe para auto-desregistrarse
self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function() {
  self.registration.unregister();
});
