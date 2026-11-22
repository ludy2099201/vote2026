const { test, expect } = require('@playwright/test');

async function expectNoIdentities(page, identities) {
  const surface = await page.evaluate(() => {
    const visible = element => !element.closest('[hidden], .hidden') && element.getClientRects().length;
    return document.body.innerText + '\n' + Array.from(document.querySelectorAll('[title], [aria-label], svg title'))
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
  for (const tab of ['matrix', 'spectrum', 'compare', 'sources', 'quiz']) {
    await page.evaluate(tab => switchMainTab(tab), tab);
    await expectNoIdentities(page, identities);
  }
  await page.evaluate(() => {
    state.quizAnswers = Object.fromEntries(QUIZ_QUESTIONS.map((q, i) => [i, q.options.find(o => o.radar).code]));
    computeQuizProfile();
    renderQuizView();
  });
  await expectNoIdentities(page, identities);
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
