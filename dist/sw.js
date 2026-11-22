/**
 * Inner Sanctum Guild Recipe Book — Service Worker
 * Provides offline support, caching strategies, and installability.
 */

const CACHE_VERSION = 'is-recipes-20261122020417';
const CACHE_NAME = `inner-sanctum-cache-${CACHE_VERSION}`;

// Core assets to pre-cache on service worker install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './recipes.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use individual fetches so missing optional files (e.g. recipes.json before export) don't fail installation
      return Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          fetch(asset, { cache: 'no-cache' })
            .then((res) => {
              if (res.ok) {
                return cache.put(asset, res);
              }
            })
            .catch(() => {
              // Ignore failure for individual pre-cache items
            })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  // Clean up old caches and take control of all active clients immediately
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // Strategy A: Cache-first / Stale-while-revalidate for images and WarcraftDB media icons
  const isImageOrMedia =
    url.hostname.includes('warcraftdb.com') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.includes('/icons/');

  if (isImageOrMedia) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        // Fetch fresh copy in background to update cache (stale-while-revalidate)
        const fetchPromise = fetch(req)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              const resToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(req, resToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Strategy B: Network-First with Cache Fallback for same-origin HTML/JSON/manifest requests
  // Ensures online users ALWAYS get the latest recipe updates and guild member roster,
  // while falling back to cache when offline or on poor network connectivity.
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShell =
    isSameOrigin &&
    (req.mode === 'navigate' ||
      url.pathname.endsWith('/') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.webmanifest'));

  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, resToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Network failed, look in cache
          const cachedResponse = await caches.match(req);
          if (cachedResponse) {
            return cachedResponse;
          }
          // If navigation, fallback to root or index.html
          if (req.mode === 'navigate') {
            return (await caches.match('./')) || (await caches.match('./index.html'));
          }
          return new Response('Offline: Resource not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // Default: Network with cache fallback
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, resToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});
