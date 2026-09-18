import { expect, test, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
}
test('landscape play, management, placement, save/reload and narrow resize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await page.getByRole('button', { name: 'Architect', exact: true }).click();
  await page.getByRole('button', { name: /Bed 10 wood/ }).click();
  const spot = await page.evaluate(() =>
    (window as any).colonyDebug.camera.screen({ x: 39, y: 38 }),
  );
  await page.touchscreen.tap(spot.x, spot.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).colonyDebug.simulation.world.blueprints.length))
    .toBe(2);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Rowan Gather priority 1' }).click();
  await expect(page.getByRole('button', { name: 'Rowan Gather priority 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.evaluate(() => (window as any).colonyDebug.step(1800));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).colonyDebug.simulation.world.buildings.filter(
            (b: any) => b.kind === 'bed',
          ).length,
      ),
    )
    .toBe(2);
  await page.evaluate(async () => (window as any).colonyDebug.save(true, true));
  const seed = await page.evaluate(() => (window as any).colonyDebug.simulation.world.seed);
  await page.reload();
  await expect(page.locator('.colonist')).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).colonyDebug.simulation.world.seed)).toBe(seed);
  expect(
    await page.evaluate(() => (window as any).colonyDebug.simulation.world.buildings.length),
  ).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kit Haul priority 1' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(667);
  await page.screenshot({ path: 'test-results/mobile-work.png' });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: 'test-results/mobile-colony.png' });
  expect(errors).toEqual([]);
});

test('tap/drag distinction, two-finger pinch, cancellation and time controls', async ({ page }) => {
  await start(page);
  const before = await page.evaluate(() => ({ ...(window as any).colonyDebug.camera }));
  await page.mouse.move(380, 210);
  await page.mouse.down();
  await page.mouse.move(470, 240, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).colonyDebug.camera.x)).toBeLessThan(before.x);
  expect(await page.evaluate(() => (window as any).colonyDebug.ui.selectedId)).toBeNull();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 360, y: 180, id: 0 },
      { x: 460, y: 180, id: 1 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 320, y: 180, id: 0 },
      { x: 500, y: 180, id: 1 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => (window as any).colonyDebug.camera.zoom)).toBeGreaterThan(
    before.zoom,
  );
  const tick = await page.evaluate(() => (window as any).colonyDebug.simulation.world.tick);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).colonyDebug.simulation.world.tick)).toBe(tick);
  for (const speed of [1, 2, 4]) {
    await page.getByRole('button', { name: `${speed}x speed`, exact: true }).click();
    expect(await page.evaluate(() => (window as any).colonyDebug.clock.speed)).toBe(speed);
  }
  await expect
    .poll(() => page.evaluate(() => (window as any).colonyDebug.simulation.world.tick))
    .toBeGreaterThan(tick);
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.mouse.move(400, 200);
  await page.mouse.wheel(0, 400);
  await page.getByRole('button', { name: 'Focus settlement' }).click();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: /Cancel plans/ }).click();
  const bp = await page.evaluate(() => {
    const d = (window as any).colonyDebug;
    return d.camera.screen(d.simulation.world.blueprints[0]);
  });
  await page.touchscreen.tap(bp.x, bp.y);
  expect(
    await page.evaluate(() => (window as any).colonyDebug.simulation.world.blueprints.length),
  ).toBe(0);
});

test('production PWA caches shell and resumes local colony fully offline', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4187/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Save now/ }).click();
  await expect(page.locator('.save-indicator')).toHaveText('Saved on this device');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => typeof (window as any).colonyDebug)).toBe('undefined');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.colonist')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select Ada' }).click();
  await expect(page.locator('.context h3')).toHaveText('Ada');
  const caches = await page.evaluate(async () => {
    const names = await window.caches.keys();
    const cache = await window.caches.open(names[0]!);
    return (await cache.keys()).map((r) => r.url);
  });
  expect(caches.some((url) => /\.js$/.test(url))).toBe(true);
  expect(caches.some((url) => /\.css$/.test(url))).toBe(true);
  expect(caches.some((url) => /icon-512\.png$/.test(url))).toBe(true);
  await page.screenshot({ path: 'test-results/offline-colony.png' });
  expect(errors).toEqual([]);
});

test('area gathering, cancelled touch and pinch in placement mode do not issue stray orders', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const d = (window as any).colonyDebug;
    d.camera.x = 34;
    d.camera.y = 40;
    d.simulation.command({
      type: 'designate',
      cancel: true,
      points: [
        { x: 34, y: 38 },
        { x: 34, y: 41 },
      ],
    });
  });
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: /Gather resources/ }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 416, y: 130, id: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 429, y: 230, id: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(
    await page.evaluate(
      () =>
        (window as any).colonyDebug.simulation.world.nodes.filter(
          (n: any) => n.x === 34 && [38, 41].includes(n.y) && n.designated,
        ).length,
    ),
  ).toBe(2);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Architect', exact: true }).click();
  await page.getByRole('button', { name: /Wall 5 wood/ }).click();
  const count = await page.evaluate(
    () => (window as any).colonyDebug.simulation.world.blueprints.length,
  );
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 380, y: 180, id: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 400, y: 200, id: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(
    await page.evaluate(() => (window as any).colonyDebug.simulation.world.blueprints.length),
  ).toBe(count);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 380, y: 180, id: 0 },
      { x: 480, y: 180, id: 1 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 360, y: 180, id: 0 },
      { x: 500, y: 180, id: 1 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(
    await page.evaluate(() => (window as any).colonyDebug.simulation.world.blueprints.length),
  ).toBe(count);
});

test('recovers a corrupt latest save from the database backup', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const d = (window as any).colonyDebug;
    d.step(230);
    await d.save(true, true);
  });
  // A static same-origin page lets us damage a test save without pagehide rewriting it.
  await page.goto('/icon.svg');
  const savedTick = await page.evaluate(async () => {
    localStorage.removeItem('hearthfield-recovery-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('hearthfield', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');
      const r = store.get('latest');
      let tick = 0;
      r.onsuccess = () => {
        const valid = r.result;
        tick = JSON.parse(valid.payload).tick;
        store.put(valid, 'backup');
        store.put({ ...valid, checksum: 'damaged' }, 'latest');
      };
      tx.oncomplete = () => {
        db.close();
        resolve(tick);
      };
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await expect(page.locator('.toast')).toContainText('unreadable save was skipped');
  const tick = await page.evaluate(() => (window as any).colonyDebug.simulation.world.tick);
  expect(tick).toBeGreaterThanOrEqual(savedTick);
  expect(tick).toBeLessThan(savedTick + 15);
});

test('storage failure starts a paused preview without overwriting existing data', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('Storage blocked for test');
      },
    });
    localStorage.setItem('hearthfield-recovery-v1', 'unreadable-preserved-copy');
  });
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await expect(page.locator('.save-indicator')).toContainText('Original saves preserved');
  expect(await page.evaluate(() => (window as any).colonyDebug.clock.speed)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('hearthfield-recovery-v1'))).toBe(
    'unreadable-preserved-copy',
  );
});

test('desktop and portrait layouts remain usable without document overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.screenshot({ path: 'test-results/desktop-colony.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.portrait-notice')).toBeVisible();
  await page.getByRole('button', { name: 'Architect', exact: true }).click();
  await expect(page.getByRole('button', { name: /Stockpile Drag/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/portrait-fallback.png' });
  expect(errors).toEqual([]);
});

test('a second tab cannot overwrite the active colony', async ({ page, context }) => {
  await start(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.colonist')).toHaveCount(3);
  await expect(second.locator('.toast')).toContainText('Another tab');
  expect(await second.evaluate(() => (window as any).colonyDebug.clock.speed)).toBe(0);
  await second.getByRole('button', { name: 'More', exact: true }).click();
  await second.getByRole('button', { name: /Save now/ }).click();
  await expect(second.locator('.toast')).toContainText('Close the other colony tab');
  await page.close();
  await second.reload();
  await expect(second.locator('.colonist')).toHaveCount(3);
  await expect(second.locator('.save-indicator')).toHaveText('Saved on this device');
});

test('a held context action survives changing needs and job status', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Select Rowan' }).click();
  const action = page.getByRole('button', { name: /Manage work priorities/ });
  const bounds = await action.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.evaluate(() => (window as any).colonyDebug.step(20));
  await page.mouse.up();
  await expect(page.locator('.panel h2')).toHaveText('Work priorities');
});
