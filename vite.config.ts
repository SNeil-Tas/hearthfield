import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0' },
  plugins: [
    {
      name: 'hearthfield-offline',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const files = [
          ...Object.keys(bundle),
          'index.html',
          'manifest.webmanifest',
          'icon.svg',
          'icons/icon-192.png',
          'icons/icon-512.png',
        ];
        const version = Date.now().toString(36);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `
const CACHE = 'hearthfield-${version}';
const ASSETS = ${JSON.stringify([...new Set(files)])};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new URL(path, self.registration.scope).href)))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hearthfield-') && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate') return (await cache.match(new URL('index.html', self.registration.scope).href)) || fetch(event.request);
    // Precache fetches and module requests can differ in Origin headers (Vary: Origin).
    // These are immutable same-origin shell assets, independent of that header.
    return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
  }));
});
`,
        });
      },
    },
  ],
});
