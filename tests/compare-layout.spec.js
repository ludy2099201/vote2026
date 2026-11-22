const { test, expect } = require('@playwright/test');

for (const width of [320, 375, 480]) {
  test(`compare view add-candidate select fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/#compare');
    const select = page.locator('#add-compare-select');
    await expect(select).toBeVisible();
    expect(await select.locator('option').count()).toBeGreaterThan(1);
    const m = await page.evaluate(() => {
      const r = document.getElementById('add-compare-select').getBoundingClientRect();
      return { right: r.right, left: r.left, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.client);
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });
}
