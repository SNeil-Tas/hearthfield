import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const [url, version, build] = process.argv.slice(2);
assert(url && version && build, 'Usage: node scripts/smoke-live.mjs URL VERSION BUILD');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 430 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.locator('.colonist').first().waitFor();
  assert.equal(await page.locator('.colonist').count(), 3);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const panel = await page.locator('.panel').textContent();
  assert(panel.includes(`Hearthfield v${version}`));
  assert(panel.includes(`Build ${build}`));
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cacheNames = await page.evaluate(() => caches.keys());
  assert(cacheNames.includes(`hearthfield-${build}`));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      url,
      version,
      build,
      status: response.status(),
      colonists: 3,
      cacheNames,
      errors,
    }),
  );
} finally {
  await browser.close();
}
