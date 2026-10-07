import { expect, test } from '@playwright/test';

test('shows personality, emotional needs and safely rendered memories on mobile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.colonist')).toHaveCount(15);
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.evaluate(() => {
    const d = (window as any).colonyDebug,
      w = d.simulation.world,
      p = w.pawns[0];
    p.psychology.needs.belonging = 12;
    p.psychology.stress = 80;
    p.psychology.overwhelmed = true;
    p.psychology.memories = [
      {
        key: 'test',
        text: '<img src=x> A difficult farewell',
        impact: -8,
        createdAt: w.tick,
        expiresAt: w.tick + 6000,
      },
    ];
    d.ui.selectedId = p.id;
    d.step(1);
  });
  const profile = page.getByRole('region', { name: 'Psychological profile' });
  await expect(profile).toContainText('OVERWHELMED');
  await expect(profile).toContainText('Belonging is running low');
  await expect(profile.locator('.personality-traits > div')).toHaveCount(6);
  await expect(profile.locator('.emotional-need')).toHaveCount(6);
  await expect(profile).toContainText('<img src=x> A difficult farewell');
  await expect(profile.locator('img')).toHaveCount(0);
  await expect(profile.getByRole('meter', { name: 'Belonging' })).toHaveAttribute('value', '12');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await profile.locator('.memory-list').scrollIntoViewIfNeeded();
    await expect(profile.locator('.memory-list')).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await profile.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/psychology-mobile.png' });
});
