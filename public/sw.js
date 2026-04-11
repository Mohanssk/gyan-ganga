const CACHE_VERSION = 'gyaan-ganga-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/style.css',
  '/images/maths.svg',
  '/images/science.svg',
  '/images/technology.svg',
  '/images/engineering.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate' && requestUrl.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (_error) {
          const cachedPage = await caches.match(request);
          if (cachedPage) {
            return cachedPage;
          }

          return caches.match('/offline.html');
        }
      })()
    );

    return;
  }

  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cachedAsset) => {
        if (cachedAsset) {
          return cachedAsset;
        }

        return fetch(request)
          .then((networkResponse) => {
            const responseCopy = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseCopy);
            });
            return networkResponse;
          })
          .catch(() => caches.match(request));
      })
    );

    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }
});
