const { test, expect } = require('@playwright/test');

test('candidate radar labels describe policy coverage, not stance scores', async ({ page }) => {
  await page.goto('/#compare');
  await expect(page.getByRole('heading', { name: '已釘選候選人：政見涵蓋度', exact: true })).toBeVisible();
  const legend = page.locator('#compare-radar-legend');
  await expect(legend).toHaveAttribute('aria-label', '政見涵蓋度圖例');
  await expect(legend).toContainText('政見涵蓋度');
  await expect(page.getByText('政見涵蓋度：有政見摘要／尚未確認。各議題請見下方並排對照。', { exact: true })).toBeVisible();
  await page.evaluate(() => switchMainTab('spectrum'));
  await expect(page.locator('#spectrum-inspector-panel')).toContainText('政見涵蓋度');
  const labels = await page.evaluate(() => {
    const read = candidate => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.innerHTML = buildHexagonRadarSVG([candidate], false);
      return {
        title: svg.querySelector('title')?.textContent,
        tips: [...svg.querySelectorAll('[data-chart-tip]')].map(node => ({
          tip: node.dataset.chartTip, aria: node.getAttribute('aria-label')
        }))
      };
    };
    return {
      covered: read(CANDIDATES.find(c => c.radar.includes(100))),
      unconfirmed: read(CANDIDATES.find(c => c.radar.includes(0))),
      user: read({ radar: [0, 20, 40, 60, 80, 100], party: 'other' })
    };
  });
  for (const candidate of [labels.covered, labels.unconfirmed]) {
    expect(candidate.title).toBe('政見涵蓋度：有政見摘要／尚未確認');
    expect(candidate.tips).toHaveLength(6);
    for (const { tip, aria } of candidate.tips) {
      expect(tip).toMatch(/^政見涵蓋度 · .+：(有政見摘要|尚未確認)$/);
      expect(aria).toBe(tip);
      expect(tip).not.toMatch(/分數|強度|\/ 100/);
    }
  }
  expect(labels.covered.tips.some(({ tip }) => tip.endsWith('有政見摘要'))).toBe(true);
  expect(labels.unconfirmed.tips.some(({ tip }) => tip.endsWith('尚未確認'))).toBe(true);
  expect(labels.user.title).toBeUndefined();
  expect(labels.user.tips.map(({ tip }) => tip)).toEqual([
    '育兒教育：0 / 100', '高齡長照：20 / 100', '軌道交通：40 / 100',
    '居住都更：60 / 100', '科技產業：80 / 100', '生態治理：100 / 100'
  ]);
});

test('candidate coverage radars are drawn in the compare view and spectrum inspector', async ({ page }) => {
  await page.goto('/#compare');
  const compare = page.locator('#compare-radar-svg');
  await expect(compare).toBeVisible();
  const pinned = await page.evaluate(() => state.pinnedIds.length);
  expect(pinned).toBeGreaterThan(1);
  // one ring plus one outline per pinned candidate
  await expect(compare.locator('polygon')).toHaveCount(pinned + 1);
  await expect(compare.locator('text')).toHaveCount(6);
  await expect(page.locator('#compare-radar-legend')).toContainText(/政見涵蓋度 \d \/ 6 項/);
  const fit = await page.evaluate(() => {
    const svg = document.getElementById('compare-radar-svg').getBoundingClientRect();
    const texts = [...document.querySelectorAll('#compare-radar-svg text')].map(t => t.getBoundingClientRect());
    return {
      inside: texts.every(t => t.left >= svg.left - 0.5 && t.right <= svg.right + 0.5 && t.top >= svg.top - 0.5 && t.bottom <= svg.bottom + 0.5),
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth
    };
  });
  expect(fit.inside).toBe(true);
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);

  await page.evaluate(() => { switchMainTab('spectrum'); selectSpectrumCandidate(CANDIDATES.find(c => c.radar.includes(0) && c.radar.includes(100)).id); });
  const inspector = page.locator('#spectrum-inspector-panel svg.coverage-radar');
  await expect(inspector).toBeVisible();
  const vertices = inspector.locator('.radar-vertex');
  await expect(vertices).toHaveCount(6);
  const tips = await vertices.evaluateAll(nodes => nodes.map(n => n.dataset.chartTip));
  expect(tips.some(t => t.endsWith('有政見摘要'))).toBe(true);
  expect(tips.some(t => t.endsWith('尚未確認'))).toBe(true);

  // Blind mode must not reveal the party through the radar colour.
  await page.evaluate(() => { if (!state.blindMode) toggleBlindMode(); });
  const colours = await page.locator('#spectrum-inspector-panel svg.coverage-radar polygon').last().evaluate(n => n.getAttribute('stroke'));
  expect(colours).toBe('#475569');
});
