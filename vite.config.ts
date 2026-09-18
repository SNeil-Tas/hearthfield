import { defineConfig } from 'vite';

const buildId =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_BUILD_ID ?? 'local';

export default defineConfig({
  base: './',
  define: { __HEARTHFIELD_BUILD_ID__: JSON.stringify(buildId.slice(0, 12)) },
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
        // A content-independent build identifier is enough to make a newly
        // deployed worker replace the previous shell. The worker itself is
        // fetched outside the application cache, so browser update checks can
        // observe this file on every deployment.
        const version = buildId.slice(0, 12);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `
const CACHE = 'hearthfield-${version}';
const ASSETS = ${JSON.stringify([...new Set(files)])};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new URL(path, self.registration.scope).href)))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hearthfield-') && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(new URL('index.html', self.registration.scope).href, response.clone());
        return response;
      } catch {
        return (await cache.match(new URL('index.html', self.registration.scope).href)) || Response.error();
      }
    }
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
