const CACHE_NAME = 'liquidador-medico-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://picsum.photos/seed/medical/192/192',
  'https://picsum.photos/seed/medical/512/512'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
