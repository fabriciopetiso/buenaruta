const CACHE_NAME = 'buenaruta-v3';
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/buena-ruta.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Solo iconos y audio van al cache
  const isStatic = STATIC_ASSETS.some(asset => url.pathname === asset);
  
  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // TODO LO DEMÁS: red directa, sin cache, nunca
  event.respondWith(fetch(event.request));
});
