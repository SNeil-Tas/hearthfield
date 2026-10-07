import { expect, test } from '@playwright/test';

test('housing needs, building knowledge, and family job requests are visible on mobile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(15);
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.evaluate(() => {
    const d = (window as any).colonyDebug,
      w = d.simulation.world;
    w.pawns = w.pawns.slice(0, 2);
    for (const name of [
      'nodes',
      'animals',
      'items',
      'blueprints',
      'buildings',
      'stockpiles',
      'dumpZones',
      'growingZones',
      'crops',
      'agriculture',
      'waterSalinity',
      'jobPosts',
      'housingProjects',
    ])
      w[name] = [];
    w.terrain.fill('soil');
    w.wildForage.fill(70);
    const [parent, child] = w.pawns;
    for (const p of w.pawns) {
      p.hunger = p.rest = p.health = p.care = 100;
      p.job = p.carrying = null;
      p.nextHousingAttempt = 0;
    }
    parent.skills.build = parent.knowledge.building = 0;
    child.ageTicks = 0;
    child.parentIds = child.ancestorIds = [parent.id];
    child.caregiverId = parent.id;
    d.ui.selectedId = parent.id;
    d.step(310);
  });
  await expect(page.locator('.context')).toContainText('Housing: Planning a home');
  await expect(page.locator('.context')).toContainText('Build skill: 0 · Building knowledge: 0');
  await page.evaluate(() => {
    const d = (window as any).colonyDebug;
    d.ui.panel = 'work';
    d.step(1);
  });
  await expect(page.locator('.job-board')).toContainText('Designing a home');
  await expect(page.locator('.job-board')).toContainText('Household housing');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/housing-design-request-mobile.png' });

  await page.evaluate(() => {
    const d = (window as any).colonyDebug,
      w = d.simulation.world;
    const parent = w.pawns[0];
    parent.skills.build = parent.knowledge.building = 8;
    parent.priorities.build = 1;
    for (let i = 0; i < 10; i++)
      w.nodes.push({
        id: `node-${w.nextId++}`,
        x: 55,
        y: 30 + i * 2,
        kind: 'tree',
        designated: false,
        work: 0,
      });
    d.ui.panel = null;
    d.step(150);
  });
  await expect(page.locator('.context')).toContainText('Housing: cottage');
  await expect(page.locator('.context')).toContainText('Building knowledge: 8');
  const beds = await page.evaluate(() => {
    const w = (window as any).colonyDebug.simulation.world;
    return w.blueprints.filter((b: any) => b.kind === 'bed').map((b: any) => b.ownerId);
  });
  expect(beds).toHaveLength(2);
  expect(new Set(beds).size).toBe(2);
  await page.screenshot({ path: 'test-results/housing-family-plan-mobile.png' });
});
