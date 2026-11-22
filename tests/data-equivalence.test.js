const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { inlineBlock } = require('../scripts/build-inline-data');

const root = path.resolve(__dirname, '..');
const names = ['CITY_PDF_URLS', 'CITY_ORDER', 'ISSUE_META', 'CANDIDATES'];
function evaluate(source) {
  return JSON.parse(vm.runInNewContext(source + '\nJSON.stringify({' + names.join(',') + '})'));
}

test('data declarations are losslessly equivalent to main @777a00f', () => {
  const original = execFileSync('git', ['show', '777a00f:index.html'], { cwd: root, encoding: 'utf8' });
  const declarations = names.map(name => {
    const match = original.match(new RegExp('    const ' + name + ' = [\\s\\S]*?^    [}\\]];', 'm'));
    assert.ok(match, 'original declaration: ' + name);
    return match[0];
  }).join('\n');
  const current = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.deepEqual(evaluate(inlineBlock(current).text), evaluate(declarations));
  const removeDeclarations = html => names.reduce((text, name) =>
    text.replace(new RegExp('    const ' + name + ' = [\\s\\S]*?^    [}\\]];', 'm'), ''), html);
  const extraction = execFileSync('git', ['show', 'a5676be:index.html'], { cwd: root, encoding: 'utf8' });
  assert.equal(extraction.replace(inlineBlock(extraction).text, ''), removeDeclarations(original));
  console.log('Equivalence: current data matches 777a00f; extraction snapshot a5676be preserved all other HTML bytes');
});
