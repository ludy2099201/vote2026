const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const csv = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(cell); cell = '';
      if (ch === '\n') { rows.push(row); row = []; }
    } else cell += ch;
  }
  expect(quoted).toBe(false);
  row.push(cell); rows.push(row);
  return rows;
}

test('county filters', async ({ page }) => {
  await page.goto('/#matrix');
  const data = await page.evaluate(() => ({ candidates: CANDIDATES, cities: CITY_ORDER, questions: QUIZ_QUESTIONS }));
  console.log(`Dataset: ${data.cities.length} counties, ${data.questions.length} questions, ${data.candidates.length} candidates`);
  expect(data.cities).toHaveLength(22);
  expect(data.questions).toHaveLength(10);
  expect(data.candidates).toHaveLength(81);
  expect(new Set(data.candidates.map(c => c.city))).toEqual(new Set(data.cities));
  const rows = page.locator('#matrix-tbody > tr');
  await expect(rows).toHaveCount(data.candidates.length);
  for (const city of data.cities) {
    await page.locator('#btn-clear-search').click();
    const expected = data.candidates.filter(c => c.city === city);
    await page.locator('#city-chip-container button').getByText(`${city}(${expected.length})`, { exact: true }).click();
    await expect(rows).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await expect(rows.nth(i).locator('td').first()).toContainText(city);
      await expect(rows.nth(i).locator('td').first()).toContainText(expected[i].name);
    }
  }
  await page.locator('#keyword-search-input').fill('NONEXISTENT_CANDIDATE_987654321');
  await expect(rows).toHaveCount(0);
  await page.locator('#btn-clear-search').click();
  await expect(rows).toHaveCount(data.candidates.length);
});

test('blind mode hides candidate names and reveals identities', async ({ page }) => {
  await page.goto('/#matrix');
  const candidates = await page.evaluate(() => CANDIDATES);
  const rows = page.locator('#matrix-tbody > tr');
  await expect(rows).toHaveCount(candidates.length);
  await page.locator('#btn-blind-toggle').click();
  await expect(page.locator('#btn-blind-toggle')).toHaveAttribute('aria-pressed', 'true');
  const visibleText = await page.locator('body').innerText();
  expect(candidates.filter(c => visibleText.includes(c.name)).map(c => c.name)).toEqual([]);
  await expect(page.locator('#party-filter-select')).toBeDisabled();
  await expect(page.locator('[onclick="exportFilteredCSV()"]')).toBeHidden();
  await page.locator('#btn-blind-toggle').click();
  await expect(page.locator('#btn-blind-toggle')).toHaveAttribute('aria-pressed', 'false');
  for (const candidate of candidates) {
    const row = rows.filter({ hasText: candidate.name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(candidate.party);
  }
});

test('blind mode strictly hides all visible identities', {
  annotation: { type: 'issue', description: 'Known bug on main: policyDisplayText() replaces candidate names but not party names in blind mode, e.g. 「司法改革黨：司法同議」' },
}, async ({ page }) => {
  await page.goto('/#matrix');
  const identities = await page.evaluate(() => [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))]);
  await page.locator('#btn-blind-toggle').click();
  await expect(page.locator('#btn-blind-toggle')).toHaveAttribute('aria-pressed', 'true');
  const visibleText = await page.locator('body').innerText();
  test.fail();
  expect(identities.filter(name => visibleText.includes(name)), 'identities leaked in visible text').toEqual([]);
});

test('CSV export', async ({ page }) => {
  await page.goto('/#matrix');
  const data = await page.evaluate(() => ({ candidates: CANDIDATES }));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[onclick="exportFilteredCSV()"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('2026_taiwan_mayoral_policy_matrix.csv');
  const csv = parseCSV(await fs.readFile(await download.path(), 'utf8'));
  expect(csv[0]).toEqual(['縣市', '號次', '候選人', '登記政黨', '競選主軸', '政見亮點', '育兒與教育', '高齡與醫療長照', '軌道交通與通勤', '居住正義與都更', '科技招商與產業', '生態能源與治理', '資源光譜X', '治理工具Y', '官方公報PDF']);
  expect(csv).toHaveLength(data.candidates.length + 1);
  for (const [i, c] of data.candidates.entries()) {
    expect(csv[i + 1]).toEqual([c.city, c.num, c.name, c.party + (c.incumbent ? '（現任）' : ''), c.slogan, c.highlights.join('；'), ...['childcare', 'senior', 'transit', 'housing', 'industry', 'governance'].map(key => c.issues[key]), String(c.x || ''), String(c.y || ''), c.pdfUrl]);
  }
});

test('quiz vector and nearest candidate matching', async ({ page }) => {
  await page.goto('/#quiz');
  const data = await page.evaluate(() => ({ candidates: CANDIDATES, questions: QUIZ_QUESTIONS }));
  expect(await page.evaluate(() => state.userSpectrumProfile)).toBeNull();
  await page.locator('#quiz-enter').click();
  const choices = data.questions.map((q, i) => q.options.filter(o => o.radar)[i % q.options.filter(o => o.radar).length]);
  for (const [i, choice] of choices.entries()) {
    await expect(page.locator(`#quiz-question-heading-${i}`)).toBeVisible();
    await page.locator(`[onclick="selectQuizOption(${i},'${choice.code}')"]`).click();
  }
  const sums = Array(6).fill(0), mins = Array(6).fill(0), maxes = Array(6).fill(0), samples = Array(6).fill(0);
  for (const [i, choice] of choices.entries()) {
    choice.radar.forEach((value, axis) => {
      const values = data.questions[i].options.filter(o => o.radar).map(o => o.radar[axis]);
      sums[axis] += value; mins[axis] += Math.min(...values); maxes[axis] += Math.max(...values);
      if (Math.max(...values) > Math.min(...values)) samples[axis]++;
    });
  }
  const radar = sums.map((value, axis) => maxes[axis] === mins[axis] ? 0 : Math.round(100 * (value - mins[axis]) / (maxes[axis] - mins[axis])));
  const x = Math.round(choices.reduce((sum, c) => sum + c.x, 0) / choices.length);
  const y = Math.round(choices.reduce((sum, c) => sum + c.y, 0) / choices.length);
  expect(await page.evaluate(() => state.userSpectrumProfile)).toMatchObject({ radar, axisSamples: samples, x, y, answeredCount: data.questions.length });
  expect(choices.filter(c => c.x !== 0).length).toBeGreaterThanOrEqual(2);
  expect(choices.filter(c => c.y !== 0).length).toBeGreaterThanOrEqual(2);
  const ranked = data.candidates.filter(c => Number.isFinite(c.x) && Number.isFinite(c.y)).map(c => ({ ...c, distance: (c.x - x) ** 2 + (c.y - y) ** 2 })).sort((a, b) => a.distance - b.distance);
  const nearest = ranked.filter(c => c.distance === ranked[0].distance);
  const match = page.locator('.match-result > div');
  await expect(match).toContainText(nearest.map(c => `${c.city} ${c.name}（${c.x}, ${c.y}）`).join('、'));
  await expect(match).toContainText(`直線距離 ${Math.sqrt(ranked[0].distance).toFixed(1)}`);
  const resultText = await match.innerText();
  for (const c of ranked.filter(c => c.distance !== ranked[0].distance)) expect(resultText).not.toContain(c.name);
});
