const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateData, checkInline } = require('../scripts/validate-candidates');
const { generateBlock } = require('../scripts/build-inline-data');
const data = require('../data/candidates-2026.json');

test('real data passes', () => assert.deepEqual(validateData(data), []));

const mutations = {
  'bad radar length': fixture => fixture.candidates[0].radar.pop(),
  'x out of range': fixture => { fixture.candidates[0].x = 76; },
  'wrong bulletin URL city': fixture => { fixture.cityBulletinUrls['臺北市'] = fixture.cityBulletinUrls['新北市']; },
  'duplicate id': fixture => { fixture.candidates[1].id = fixture.candidates[0].id; },
  'extra property': fixture => { fixture.candidates[0].extra = true; },
  'missing issue key': fixture => { delete fixture.candidates[0].issues.childcare; },
  'unknown city': fixture => { fixture.candidates[0].city = '不存在'; },
  'inconsistent prefix': fixture => { fixture.candidates[1].id = 'BAD-2'; },
  'duplicate number': fixture => { fixture.candidates[1].num = fixture.candidates[0].num; },
  'wrong axis order': fixture => { const value = fixture.issueMeta.childcare; delete fixture.issueMeta.childcare; fixture.issueMeta.childcare = value; },
  'wrong city order': fixture => fixture.cityOrder.reverse(),
  'empty candidates': fixture => { fixture.candidates = []; },
  'malformed encoded URL': fixture => { fixture.cityBulletinUrls['臺北市'] += '%ZZ'; }
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(name + ' fails', () => {
    const fixture = structuredClone(data);
    mutate(fixture);
    assert.ok(validateData(fixture).length > 0);
  });
}

test('empty input fails', () => assert.ok(validateData({}).length > 0));
test('all independent semantic errors are listed', () => {
  const fixture = structuredClone(data);
  fixture.candidates[1].id = fixture.candidates[0].id;
  fixture.candidates[1].num = fixture.candidates[0].num;
  assert.equal(validateData(fixture).length, 2);
});
test('inline block is in sync', () => {
  assert.deepEqual(checkInline(data, fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')), []);
});
test('stale and absent inline blocks fail', () => {
  assert.ok(checkInline(data, '').length);
  assert.ok(checkInline(data, generateBlock(data).replace('const CANDIDATES_2026', 'const STALE')).length);
});
test('generated JSON cannot terminate its script', () => {
  assert.ok(!generateBlock({ text: '</script>' }).includes('</script>'));
});
