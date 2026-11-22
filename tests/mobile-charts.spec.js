const { test, expect } = require('@playwright/test');

async function chartGeometry(svg, scatter = false) {
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((svg, scatter) => {
    const rect = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')];
    const outside = (r, b) => r.left < b.left - .5 || r.right > b.right + .5 || r.top < b.top - .5 || r.bottom > b.bottom + .5;
    const overlap = (a, b) => Math.min(a.right,b.right) > Math.max(a.left,b.left)+.1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)+.1;
    const pairs = items => items.reduce((n,a,i) => n + items.slice(i+1).filter(b=>overlap(a.getBoundingClientRect(),b.getBoundingClientRect())).length,0);
    const labels = [...svg.querySelectorAll('.spectrum-node text')];
    const pins = [...svg.querySelectorAll('.chart-pin')];
    const captions = [...svg.querySelectorAll('.chart-caption')];
    const scale = svg.getScreenCTM().a;
    let pinOverlaps = 0;
    pins.forEach((p,i) => pins.slice(i+1).forEach(q => {
      if (Math.hypot(p.cx.baseVal.value-q.cx.baseVal.value,p.cy.baseVal.value-q.cy.baseVal.value) < p.r.baseVal.value+q.r.baseVal.value-.01) pinOverlaps++;
    }));
    return {
      outsideSVG: texts.filter(t=>outside(t.getBoundingClientRect(),rect)).length,
      outsideViewport: texts.filter(t=>outside(t.getBoundingClientRect(),{left:0,top:0,right:innerWidth,bottom:innerHeight})).length,
      minFont: Math.min(...texts.map(t=>parseFloat(getComputedStyle(t).fontSize)*scale)),
      ...(scatter ? {labelOverlaps:pairs(labels), captionOverlaps:pairs(captions), pinOverlaps,
        labelPinOverlaps:labels.reduce((n,l)=>n+pins.filter(p=>p.parentElement!==l.parentElement && overlap(l.getBoundingClientRect(),p.getBoundingClientRect())).length,0)} : {})
    };
  }, scatter);
}

async function tooltipInside(page) {
  const tip = page.locator('#chart-tooltip');
  await expect(tip).toBeVisible();
  const b = await tip.boundingBox();
  const v = page.viewportSize();
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x+b.width).toBeLessThanOrEqual(v.width);
  expect(b.y+b.height).toBeLessThanOrEqual(v.height);
}

async function tapOccludedMarker(page, svg, overlapRegion = false) {
  await svg.scrollIntoViewIfNeeded();
  const marker = await svg.evaluate((svg,overlapRegion) => {
    for (const hit of svg.querySelectorAll('.chart-hit')) {
      const others = overlapRegion ? [...svg.querySelectorAll('.chart-hit')].filter(h=>h!==hit) : [hit];
      for (const other of others) {
      const local = new DOMPoint(hit.cx.baseVal.value*.55+other.cx.baseVal.value*.45,hit.cy.baseVal.value*.55+other.cy.baseVal.value*.45);
      const distance = h => Math.hypot(local.x-h.cx.baseVal.value,local.y-h.cy.baseVal.value);
      if (distance(hit)>hit.r.baseVal.value || [...svg.querySelectorAll('.chart-hit')].some(h=>distance(h)<distance(hit)-.01)) continue;
      const point = local.matrixTransform(svg.getScreenCTM());
      const covering = document.elementFromPoint(point.x,point.y);
      if (covering?.matches('.chart-hit') && covering.parentElement !== hit.parentElement) {
        return {x:point.x-visualViewport.offsetLeft,y:point.y-visualViewport.offsetTop,tip:hit.parentElement.dataset.chartTip,id:hit.parentElement.getAttribute('onclick')?.match(/'([^']+)'/)?.[1]};
      }
      }
    }
    return null;
  },overlapRegion);
  expect(marker, 'fixture must contain a marker covered by another hit circle').not.toBeNull();
  await page.touchscreen.tap(marker.x,marker.y);
  await expect(page.locator('#chart-tooltip')).toHaveText(marker.tip);
  if (marker.id) expect(await page.evaluate(()=>state.selectedCandidateId)).toBe(marker.id);
}

for (const width of [320,375,414,480]) {
  test.describe(`${width}px touch`, () => {
    test.use({viewport:{width,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    test('charts stay readable, separated, and tappable', async ({page}) => {
      await page.goto('/#spectrum');
      await page.evaluate(()=>document.documentElement.style.scrollBehavior='auto');
      const scatter = page.locator('#spectrum-svg');
      await tapOccludedMarker(page,scatter);
      for (const mode of ['orientation','density']) {
        await page.locator(`#btn-spec-mode-${mode}`).click();
        const cards = page.locator('#quadrant-summary-cards');
        if (mode === 'orientation') {
          await expect(cards).toBeVisible();
          await expect(cards).toContainText('12 人');
          await expect(cards).toContainText('47 人');
          await expect(cards).toContainText('17 人');
          await expect(cards).toContainText('5 人');
          await expect(scatter.locator('.chart-halo')).toHaveCount(1);
          expect(await scatter.locator('.chart-pin[r="6.5"]').count()).toBe(1);
          await expect(scatter.locator('.spectrum-node title')).toHaveCount(81);
          expect(await scatter.locator('.chart-pin').evaluateAll(pins => pins.filter(p => Math.abs(p.cx.baseVal.value-Math.round(p.cx.baseVal.value)) > .01).length)).toBeGreaterThan(40);
        } else await expect(cards).toBeHidden();
        const g = await chartGeometry(scatter,true);
        expect(g.outsideSVG).toBe(0);
        expect(g.outsideViewport).toBe(0);
        expect(g.minFont).toBeGreaterThanOrEqual(9.5);
        expect(g.labelOverlaps).toBe(0);
        expect(g.captionOverlaps).toBe(0);
        expect(g.pinOverlaps).toBe(0);
        expect(g.labelPinOverlaps).toBe(0);
      }
      const pin = scatter.locator('.spectrum-node').last();
      const name = (await pin.getAttribute('data-chart-tip')).split(' · ')[0];
      await pin.locator('.chart-hit').tap();
      await tooltipInside(page);
      await expect(page.locator('#chart-tooltip')).toContainText(name);
      await page.locator('header').tap({position:{x:5,y:5}});
      await expect(page.locator('#chart-tooltip')).toHaveCount(0);
      const keyboardPin = scatter.locator('.spectrum-node').last();
      await keyboardPin.focus();
      await page.keyboard.press('Enter');
      await tooltipInside(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#chart-tooltip')).toHaveCount(0);
      await scatter.locator('.spectrum-node').last().locator('.chart-hit').tap();
      await page.evaluate(()=>window.scrollBy(0,20));
      await expect(page.locator('#chart-tooltip')).toHaveCount(0);
      await page.locator('#tab-btn-quiz').click();
      await page.locator('#quiz-enter').click();
      for (let i=0;i<10;i++) await page.locator(`button[onclick="selectQuizOption(${i},'A')"]`).click();
      const radar = page.locator('#quiz-results-container svg');
      const g = await chartGeometry(radar);
      expect(g.outsideSVG).toBe(0);
      expect(g.outsideViewport).toBe(0);
      expect(g.minFont).toBeGreaterThanOrEqual(9.5);
      await tapOccludedMarker(page,radar,true);
      await radar.locator('.radar-vertex').last().locator('.chart-hit').tap();
      await tooltipInside(page);
      await expect(page.locator('#chart-tooltip')).toContainText('/ 100');
      await page.setViewportSize({width:600,height:844});
      await page.locator('#tab-btn-spectrum').click();
      await page.locator('#btn-spec-mode-orientation').click();
      await expect(page.locator('#spectrum-svg .spectrum-node')).toHaveCount(82);
      await page.setViewportSize({width:1280,height:900});
      await expect(scatter).toHaveAttribute('viewBox','0 0 760 540');
      await page.setViewportSize({width,height:844});
      await expect(scatter).not.toHaveAttribute('viewBox','0 0 760 540');
      await scatter.scrollIntoViewIfNeeded();
      await scatter.locator('.spectrum-node').last().locator('.chart-hit').tap();
      await tooltipInside(page);
      await expect(page.locator('#chart-tooltip')).toContainText('您的測驗座標');
    });
  });
}

test('desktop retains 81 candidate pins', async ({page}) => {
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/#spectrum');
  await expect(page.locator('#spectrum-svg .spectrum-node')).toHaveCount(81);
  await expect(page.locator('#spectrum-svg')).toHaveAttribute('viewBox','0 0 760 540');
});

test('empty spectrum filter clears the chart without errors', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#spectrum');
  await page.evaluate(()=>{ state.selectedCities = new Set(); renderSpectrumView(); });
  await expect(page.locator('#spectrum-svg .spectrum-node')).toHaveCount(0);
  await expect(page.locator('#spectrum-inspector-panel')).toContainText('目前篩選範圍沒有候選人');
  expect(errors).toEqual([]);
});
