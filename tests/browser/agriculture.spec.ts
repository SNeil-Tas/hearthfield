import { expect, test } from '@playwright/test';

test('mobile agriculture inspector, crop choice and physical starting supplies', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(3);
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  for (const [resource, species, label] of [
    ['seed', 'potato', '20 Potato seed'],
    ['seed', 'grain', '12 Grain seed'],
    ['fertilizer', null, '8 fertilizer'],
  ] as const) {
    await page.evaluate(
      ({ resource, species }) => {
        const d = (window as any).colonyDebug;
        d.ui.selectedId = d.simulation.world.items.find(
          (i: any) => i.resource === resource && (!species || i.seedType === species),
        ).id;
        d.step(0);
      },
      { resource, species },
    );
    await expect(page.locator('.context')).toContainText(label);
  }
  await page.getByRole('button', { name: 'Architect', exact: true }).click();
  await page.getByRole('button', { name: /Growing zone/ }).click();
  const point = await page.evaluate(() =>
    (window as any).colonyDebug.camera.screen({ x: 36, y: 36 }),
  );
  await page.touchscreen.tap(point.x, point.y);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('.context')).toContainText('Crop: Potato');
  await expect(page.locator('.context')).toContainText('Unplanted');
  await page.getByRole('button', { name: /Grain 12 seed/ }).click();
  await expect(page.locator('.context')).toContainText('Crop: Grain');
  await page.getByRole('button', { name: /Potato 20 seed/ }).click();
  const planted = await page.evaluate(() => {
    const d = (window as any).colonyDebug,
      w = d.simulation.world;
    for (let i = 0; i < 1500 && !w.crops.length; i++) d.simulation.step();
    d.ui.selectedId = w.crops[0]?.id;
    d.step(0);
    return {
      count: w.crops.length,
      seeds:
        w.items
          .filter((i: any) => i.seedType === 'potato')
          .reduce((n: number, i: any) => n + i.quantity, 0) +
        w.pawns.reduce(
          (n: number, p: any) => n + (p.carrying?.seedType === 'potato' ? p.carrying.quantity : 0),
          0,
        ),
    };
  });
  expect(planted).toEqual({ count: 1, seeds: 19 });
  for (const text of [
    'Crop: Potato',
    'Stage: Seeded',
    'Growth:',
    'Moisture:',
    'Nutrients:',
    'Temperature: Not simulated / Suitable',
    'Status:',
  ])
    await expect(page.locator('.context')).toContainText(text);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /Berry 0 seed/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/agriculture-portrait.png' });
  await page.setViewportSize({ width: 667, height: 375 });
  // The existing inspector scrolls on short screens; crop controls must remain reachable.
  await page.getByRole('button', { name: /Berry 0 seed/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: /Berry 0 seed/ })).toBeInViewport();
  await page.getByRole('button', { name: /Berry 0 seed/ }).tap();
  await expect(page.getByRole('button', { name: /Berry 0 seed/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/agriculture-landscape.png' });
});

test('accelerated browser smoke covers rainfall, roof, watering, fertilizer, harvest and replanting', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixturesPath = '/tests/sim/fixtures.ts',
      simulationPath = '/src/sim/simulation.ts',
      agriculturePath = '/src/sim/agriculture.ts',
      topologyPath = '/src/sim/topology.ts',
      boardPath = '/src/sim/job-board.ts';
    const { flatWorld } = await import(fixturesPath),
      { Simulation } = await import(simulationPath),
      a = await import(agriculturePath),
      { roomTopology } = await import(topologyPath),
      { workCandidates } = await import(boardPath);
    const w = flatWorld();
    w.pawns = [w.pawns[0]];
    w.pawns[0].priorities = { plants: 1, build: 0, haul: 0, cook: 0 };
    w.terrain[8 * w.width + 8] = 'water';
    const sim = new Simulation(w);
    sim.command({
      type: 'growing',
      points: [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
      ],
    });
    a.dropSeed(w, { x: 2, y: 3 }, 'potato', 1);
    for (let i = 0; i < 300 && !w.crops.length; i++) sim.step();
    const crop = w.crops[0],
      soil = a.agricultureAt(w, crop);
    const control = w.agriculture.find((s: any) => s !== soil);
    soil.moisture = control.moisture = 40;
    roomTopology(w).setRoof(
      { x: control.key % w.width, y: Math.floor(control.key / w.width) },
      true,
    );
    w.weather = 'rain';
    w.weatherUntil = w.tick + 100000;
    a.advanceAgriculture(w, 100);
    const rain = soil.moisture > 40,
      roof = control.moisture < 40;
    soil.moisture = 20;
    const wateringWork = workCandidates(w).some((c: any) => c.kind === 'water');
    for (let i = 0; i < 1000 && soil.moisture < 40; i++) sim.step();
    const watered =
      soil.moisture > 40 &&
      sim.diagnostics.snapshot().some((e: any) => e.type === 'WATERING_COMPLETED');
    soil.nutrients = 10;
    w.items.push({ id: `item-${w.nextId++}`, x: 2, y: 3, resource: 'fertilizer', quantity: 1 });
    for (let i = 0; i < 1000 && soil.nutrients < 30; i++) sim.step();
    const fertilized =
      soil.nutrients > 30 &&
      !w.items.some((i: any) => i.resource === 'fertilizer') &&
      !w.pawns[0].carrying;
    const beforeNutrients = soil.nutrients;
    a.advanceAgriculture(w, 100);
    const depleted = soil.nutrients < beforeNutrients;
    const stages = new Set<string>();
    // Maintain soil while accelerating the actual multi-day lifecycle.
    for (let i = 0; i < 1000 && crop.growth < 1; i++) {
      soil.moisture = 60;
      soil.nutrients = 82;
      stages.add(a.cropStage(crop.growth));
      a.advanceAgriculture(w, 100);
    }
    stages.add(a.cropStage(crop.growth));
    for (let i = 0; i < 500 && w.crops.includes(crop); i++) sim.step();
    const food = w.items
      .filter((i: any) => i.resource === 'food')
      .reduce((n: number, i: any) => n + i.quantity, 0);
    const seeds = w.items
      .filter((i: any) => i.resource === 'seed')
      .reduce((n: number, i: any) => n + i.quantity, 0);
    const canReplant = workCandidates(w).some((c: any) => c.kind === 'sow');
    w.items = w.items.filter((i: any) => i.resource !== 'seed');
    const blockedWithoutSeed = !workCandidates(w).some((c: any) => c.kind === 'sow');
    return {
      rain,
      roof,
      wateringWork,
      watered,
      fertilized,
      depleted,
      stages: [...stages],
      food,
      seeds,
      canReplant,
      blockedWithoutSeed,
    };
  });
  expect(result).toEqual({
    rain: true,
    roof: true,
    wateringWork: true,
    watered: true,
    fertilized: true,
    depleted: true,
    stages: ['seeded', 'germinating', 'seedling', 'growing', 'mature'],
    food: 48,
    seeds: 2,
    canReplant: true,
    blockedWithoutSeed: true,
  });
});
