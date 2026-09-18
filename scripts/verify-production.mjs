import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const read = (name) => readFileSync(join(dist, name), 'utf8');
const required = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

for (const name of required) {
  if (!existsSync(join(dist, name))) throw new Error(`Missing production asset: ${name}`);
}

const index = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const worker = read('sw.js');
if (/src="\/(?!\/)/.test(index))
  throw new Error('Production HTML contains a root-absolute asset URL.');
if (!index.includes('./assets/'))
  throw new Error('Production HTML does not contain relative bundled assets.');
if (!manifest.start_url.startsWith('./') || !manifest.scope.startsWith('./'))
  throw new Error('Manifest start_url and scope must be relative for project pages.');
if (!worker.includes('CACHE =') || !worker.includes('index.html'))
  throw new Error('Generated service worker is missing its versioned shell cache.');

console.log('Production asset paths, manifest, icons, and service worker look valid.');
