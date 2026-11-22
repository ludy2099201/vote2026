const { test, expect } = require('@playwright/test');

async function expectNoIdentities(page, identities) {
  const surface = await page.evaluate(() => {
    const visible = element => !element.closest('[hidden], .hidden') && element.getClientRects().length;
    return Array.from(document.querySelectorAll('[data-chart-tip]'), element => element.dataset.chartTip).join('\n')
      + '\n' + document.body.innerText + '\n' + Array.from(document.querySelectorAll('[title], [aria-label], svg title'))
      .filter(element => visible(element) || (element.tagName.toLowerCase() === 'title' && visible(element.parentElement)))
      .map(element => [element.getAttribute('title'), element.getAttribute('aria-label'), element.tagName.toLowerCase() === 'title' ? element.textContent : ''].join(' ')).join('\n');
  });
  expect(identities.filter(identity => surface.includes(identity)), 'rendered identity leaks').toEqual([]);
}

test('blind identities stay masked across views, tooltips, modal and exports', async ({ page }) => {
  await page.goto('/#matrix');
  const original = await page.evaluate(() => JSON.stringify(CANDIDATES));
  const identities = await page.evaluate(() => [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))]);
  await page.locator('#btn-blind-toggle').click();
  const partyOptions = await page.locator('#party-filter-select').textContent();
  expect(identities.filter(identity => partyOptions.includes(identity))).toEqual([]);
  for (const tab of ['matrix', 'spectrum', 'compare', 'sources', 'quiz']) {
    await page.evaluate(tab => switchMainTab(tab), tab);
    await expectNoIdentities(page, identities);
  }
  await page.evaluate(() => {
    state.quizAnswers = Object.fromEntries(QUIZ_QUESTIONS.map((q, i) => [i, q.options.find(o => o.radar).code]));
    computeQuizProfile();
    enterQuiz();
  });
  await expectNoIdentities(page, identities);
  const duelText = await page.evaluate(() => CANDIDATES.flatMap(candidate =>
    Object.keys(ISSUE_META).map(key => renderDuelCard(candidate, key) + renderDuelReview(candidate, key))).join('\n'));
  expect(identities.filter(identity => duelText.includes(identity)), 'duel identity leaks').toEqual([]);
  await page.evaluate(() => openCandidateModal(CANDIDATES.find(c => c.party === '司法改革黨').id));
  await expectNoIdentities(page, identities);
  await page.evaluate(() => closeCandidateModal());
  const exports = await page.evaluate(() => {
    let downloads = 0, copies = 0;
    const download = triggerCSVDownload, copy = copyTextToClipboard;
    triggerCSVDownload = () => downloads++;
    copyTextToClipboard = () => copies++;
    try {
      exportFilteredCSV();
      exportComparisonCSV();
      copyComparisonSummary();
      return { downloads, copies };
    } finally {
      triggerCSVDownload = download;
      copyTextToClipboard = copy;
    }
  });
  expect(exports).toEqual({ downloads: 0, copies: 0 });
  expect(await page.evaluate(() => JSON.stringify(CANDIDATES))).toBe(original);
  await page.locator('#btn-blind-toggle').click();
  await page.evaluate(() => switchMainTab('matrix'));
  await expect(page.locator('#matrix-tbody')).toContainText('司法改革黨');
});

test('display masking handles empty, repeated and overlapping identities without changing source text', async ({ page }) => {
  await page.goto('/#matrix');
  const result = await page.evaluate(() => {
    const text = CANDIDATES.map(c => `${c.name} ${c.party}`).join('；');
    toggleBlindMode();
    const masked = policyDisplayText(text + text);
    const empty = [policyDisplayText(''), policyDisplayText(null), policyDisplayText(undefined)];
    toggleBlindMode();
    return { masked, empty, revealed: policyDisplayText(text), text,
      leaks: CANDIDATES.filter(c => masked.includes(c.name) || masked.includes(c.party)).map(c => c.id) };
  });
  expect(result.leaks).toEqual([]);
  expect(result.empty).toEqual(['', null, undefined]);
  expect(result.revealed).toBe(result.text);
});

test('matrix cache separates blind rows from revealed rows through filtering and reordering', async ({ page }) => {
  await page.goto('/#matrix');
  for (const issue of ['all', 'childcare']) {
    const result = await page.evaluate(issue => {
      setSelectedIssue(issue);
      const identities = [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))];
      const rows = () => [...document.querySelectorAll('#matrix-tbody > tr')];
      const revealed = new Set(rows());
      toggleBlindMode();
      const blind = new Set(rows());
      const freshBlind = rows().every(row => !revealed.has(row));
      setRegionPreset('nnkt');
      const filteredCacheHit = rows().every(row => blind.has(row));
      setRegionPreset('all');
      const sortedCacheHit = rows().every(row => blind.has(row));
      const masked = document.getElementById('matrix-tbody').textContent;
      toggleBlindMode();
      const freshRevealed = rows().every(row => !blind.has(row));
      const allRestored = CANDIDATES.every(c => rows().some(row => row.textContent.includes(c.name) && row.textContent.includes(c.party)));
      const restored = new Set(rows());
      setRegionPreset('nnkt');
      setRegionPreset('all');
      return { freshBlind, filteredCacheHit, sortedCacheHit, freshRevealed, allRestored,
        revealedCacheHit: rows().every(row => restored.has(row)),
        leaks: identities.filter(identity => masked.includes(identity)) };
    }, issue);
    expect(result).toEqual({ freshBlind: true, filteredCacheHit: true, sortedCacheHit: true,
      freshRevealed: true, allRestored: true, revealedCacheHit: true, leaks: [] });
  }
});

for (const width of [320, 375, 414, 480]) {
  test.describe(`${width}px blind touch tooltips`, () => {
    test.use({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    test('chart attributes and rendered tooltips mask identities and restore on reveal', async ({ page }) => {
      await page.goto('/#spectrum');
      await page.evaluate(() => document.documentElement.style.scrollBehavior = 'auto');
      const identities = await page.evaluate(() => [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))]);
      const node = page.locator('#spectrum-svg .spectrum-node').last();
      await node.locator('.chart-hit').tap();
      await expect(page.locator('#chart-tooltip')).toBeVisible();
      await page.evaluate(() => toggleBlindMode());
      await expect(page.locator('#chart-tooltip')).toHaveCount(0);
      for (const mode of ['orientation', 'density']) {
        await page.locator(`#btn-spec-mode-${mode}`).click();
        await expectNoIdentities(page, identities);
        await node.locator('.chart-hit').tap();
        await expect(page.locator('#chart-tooltip')).toBeVisible();
        await expectNoIdentities(page, identities);
        await page.keyboard.press('Escape');
      }
      await page.evaluate(() => switchMainTab('matrix'));
      await expectNoIdentities(page, identities);
      await page.evaluate(() => toggleBlindMode());
      await page.evaluate(() => switchMainTab('spectrum'));
      const tip = await node.getAttribute('data-chart-tip');
      expect(identities.some(identity => tip.includes(identity))).toBe(true);
      await node.locator('.chart-hit').tap();
      await expect(page.locator('#chart-tooltip')).toBeVisible();
      const revealed = await page.locator('#chart-tooltip').textContent();
      expect(identities.some(identity => revealed.includes(identity))).toBe(true);
    });
  });
}
