const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/#matrix');
});

test('region filters preserve rows and chips; pin replaces just its row', async ({ page }) => {
  const result = await page.evaluate(() => {
    const rows = () => [...document.querySelectorAll('#matrix-tbody > tr')];
    const original = rows();
    original.forEach(row => { row.marker = true; });
    const chips = [...document.querySelectorAll('#city-chip-container button')];
    setRegionPreset('nnkt');
    const filtered = rows();
    const retained = filtered.every(row => row.marker);
    const count = filtered.length === getFilteredCandidates().length;
    const readout = document.getElementById('filtered-count-readout').textContent;
    setRegionPreset('all');
    const restored = rows().every(row => row.marker);
    const beforePin = rows();
    togglePinCandidate(state.pinnedIds[0]);
    return {
      total: CANDIDATES.length, retained, count, restored, readout,
      filteredCount: filtered.length,
      changed: rows().filter((row, i) => row !== beforePin[i]).length,
      chipsSame: chips.every((chip, i) => chip === document.querySelectorAll('#city-chip-container button')[i])
    };
  });
  expect(result.total).toBe(81);
  expect(result.retained && result.count && result.restored && result.chipsSame).toBe(true);
  expect(result.readout).toContain(result.filteredCount + ' / 81');
  expect(result.changed).toBe(1);
});

test('blind names mask and restore in both matrix layouts', async ({ page }) => {
  for (const issue of ['all', 'childcare']) {
    const result = await page.evaluate(issue => {
      state.selectedIssue = issue;
      renderAll();
      toggleBlindMode();
      const masked = document.getElementById('matrix-tbody').textContent;
      const leaks = CANDIDATES.filter(c => masked.includes(c.name)).map(c => c.name);
      toggleBlindMode();
      const restored = document.getElementById('matrix-tbody').textContent;
      return { leaks, restored: CANDIDATES.every(c => restored.includes(c.name)) };
    }, issue);
    expect(result.leaks).toEqual([]);
    expect(result.restored).toBe(true);
  }
});

test('empty filters recover and issue changes invalidate the header and rows', async ({ page }) => {
  const result = await page.evaluate(() => {
    state.selectedCities.clear();
    renderAll();
    const empty = document.querySelectorAll('#matrix-tbody > tr').length;
    setRegionPreset('all');
    state.selectedIssue = 'childcare';
    renderAll();
    return { empty, rows: document.querySelectorAll('#matrix-tbody > tr').length,
      columns: document.querySelector('#matrix-tbody > tr').children.length };
  });
  expect(result).toEqual({ empty: 0, rows: 81, columns: 5 });
});

test('compare options persist, six cards render, limits and unchanged sections are guarded', async ({ page }) => {
  const result = await page.evaluate(() => {
    switchMainTab('compare');
    const options = [...document.querySelectorAll('#add-compare-select option')];
    togglePinCandidate(state.pinnedIds[0]);
    const same = options.every((option, i) => option === document.querySelectorAll('#add-compare-select option')[i]);
    const disabled = options.every(option => option.disabled === state.pinnedIds.includes(option.value));
    loadComparePreset(CANDIDATES.slice(0, 6).map(c => c.id));
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.getElementById('compare-table'), { childList: true, subtree: true });
    renderCompareView();
    mutations += observer.takeRecords().length;
    observer.disconnect();
    const legends = document.getElementById('compare-radar-legend').children.length;
    const cards = document.getElementById('compare-metrics-cards').children.length;
    togglePinCandidate(CANDIDATES[6].id);
    const max = state.pinnedIds.length;
    loadComparePreset([CANDIDATES[0].id]);
    togglePinCandidate(CANDIDATES[0].id);
    const min = state.pinnedIds.length;
    loadComparePreset([]);
    const empty = document.getElementById('compare-metrics-cards').children.length;
    return { same, disabled, mutations, legends, cards, max, min, empty };
  });
  expect(result).toEqual({ same: true, disabled: true, mutations: 0, legends: 6, cards: 6, max: 6, min: 1, empty: 0 });
});
