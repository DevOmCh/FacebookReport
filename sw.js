'use strict';

const CACHE_VERSION = 'facebookreport-v7-20260914';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SCOPE = self.registration.scope;
const coreUrl = path => new URL(path, SCOPE).href;

const CORE_ASSETS = [
  coreUrl('./'),
  coreUrl('./index.html'),
  coreUrl('./offline.html'),
  coreUrl('./manifest.webmanifest'),
  coreUrl('./favicon.svg'),
  coreUrl('./pwa-register.js'),
  coreUrl('./phase7.css'),
  coreUrl('./phase7.js')
];

const STATIC_REMOTE_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'images.unsplash.com'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith('facebookreport-') && ![CORE_CACHE, RUNTIME_CACHE].includes(key))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  return cached || networkPromise;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CORE_CACHE);
      cache.put(coreUrl('./index.html'), response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cache = await caches.open(CORE_CACHE);
    return (await cache.match(coreUrl('./index.html'))) || (await cache.match(coreUrl('./offline.html')));
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Keep Google Sheets data network-only so activity data is never silently stale.
  if (url.hostname === 'docs.google.com') return;

  if (STATIC_REMOTE_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
