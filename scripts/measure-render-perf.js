const { chromium } = require('@playwright/test');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, copyFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const scenarios = [
  ['Matrix region 北北基桃 ↔ all', 'matrix', 'region'],
  ['Matrix city chip', 'matrix', 'city'],
  ['Matrix blind', 'matrix', 'blind'],
  ['Compare blind (6)', 'compare', 'blind'],
  ['Compare pin/unpin', 'compare', 'pin']
];

async function serve(dir) {
  const server = spawn('python3', ['-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', dir], {
    env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const url = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', code => reject(new Error('HTTP server exited: ' + code)));
    server.stdout.on('data', data => {
      const match = data.toString().match(/port (\d+)/);
      if (match) resolve('http://127.0.0.1:' + match[1]);
    });
  });
  return { url, close: () => server.kill() };
}

async function measure(browser, url) {
  const results = [];
  for (const [name, tab, action] of scenarios) {
    const page = await browser.newPage();
    // The app is local; third-party resources must not affect reproducibility.
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.abort());
    await page.goto(url + '/#' + tab);
    await page.evaluate(() => {
      loadComparePreset(CANDIDATES.slice(0, 6).map(c => c.id));
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const samples = [];
    for (let i = 0; i < 24; i++) {
      const sample = await page.evaluate(async ({ action, i }) => {
        let added = 0, removed = 0;
        const count = node => 1 + (node.querySelectorAll ? node.querySelectorAll('*').length : 0);
        const observer = new MutationObserver(records => records.forEach(record => {
          record.addedNodes.forEach(node => { added += count(node); });
          record.removedNodes.forEach(node => { removed += count(node); });
        }));
        observer.observe(document.body, { childList: true, subtree: true });
        const start = performance.now();
        if (action === 'region') setRegionPreset(i % 2 === 0 ? 'nnkt' : 'all');
        if (action === 'city') toggleCitySelection(CITY_ORDER[0]);
        if (action === 'blind') toggleBlindMode();
        if (action === 'pin') togglePinCandidate(CANDIDATES[5].id);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const ms = performance.now() - start;
        observer.disconnect();
        return { ms, added, removed };
      }, { action, i });
      if (i >= 4) samples.push(sample);
    }
    const percentile = (key, p) => [...samples].sort((a, b) => a[key] - b[key])[Math.ceil(samples.length * p) - 1][key];
    results.push({ name, median: percentile('ms', .5).toFixed(1), p95: percentile('ms', .95).toFixed(1),
      added: percentile('added', .5), removed: percentile('removed', .5) });
    await page.close();
  }
  return results;
}

(async () => {
  const browser = await chromium.launch();
  const servers = [];
  let oldDir;
  try {
    let targets;
    if (args[0] === '--url') targets = [['Target', args[1]]];
    else if (args[0]) {
      const server = await serve(path.resolve(args[0]));
      servers.push(server);
      targets = [['Target', server.url]];
    } else {
      oldDir = mkdtempSync(path.join(tmpdir(), 'vote2026-before-'));
      writeFileSync(path.join(oldDir, 'index.html'), execFileSync('git', ['show', 'main:index.html'], { cwd: root }));
      for (const file of ['atlas.css', 'compass.svg']) copyFileSync(path.join(root, file), path.join(oldDir, file));
      const before = await serve(oldDir), after = await serve(root);
      servers.push(before, after);
      targets = [['Before (main)', before.url], ['After', after.url]];
    }
    console.log('CPU: 4x; 4 warmups + 20 samples per scenario; double rAF; DOM counts include descendants.');
    console.log('| Version | Scenario | Median ms | p95 ms | Added nodes (median) | Removed nodes (median) |');
    console.log('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const [label, url] of targets) {
      for (const r of await measure(browser, url)) {
        console.log(`| ${label} | ${r.name} | ${r.median} | ${r.p95} | ${r.added} | ${r.removed} |`);
      }
    }
  } finally {
    await browser.close();
    servers.forEach(server => server.close());
    if (oldDir) rmSync(oldDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
