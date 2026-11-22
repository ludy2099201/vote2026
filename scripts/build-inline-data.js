const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const BEGIN = '    // BEGIN GENERATED: data/candidates-2026.json';
const END = '    // END GENERATED';

function generateBlock(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `${BEGIN}\n    const CANDIDATES_2026 = ${json};\n    const CITY_PDF_URLS = CANDIDATES_2026.cityBulletinUrls;\n    const CITY_ORDER = CANDIDATES_2026.cityOrder;\n    const ISSUE_META = CANDIDATES_2026.issueMeta;\n    const CANDIDATES = CANDIDATES_2026.candidates;\n${END}`;
}

function inlineBlock(html) {
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END, start);
  if (start < 0 || end < 0 || html.indexOf(BEGIN, start + BEGIN.length) !== -1 || html.indexOf(END, end + END.length) !== -1) {
    throw new Error('Expected exactly one generated data block');
  }
  return { start, end: end + END.length, text: html.slice(start, end + END.length) };
}

if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/candidates-2026.json'), 'utf8'));
  const file = path.join(root, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const block = inlineBlock(html);
  fs.writeFileSync(file, html.slice(0, block.start) + generateBlock(data) + html.slice(block.end));
  console.log('Updated index.html generated data block');
}

module.exports = { generateBlock, inlineBlock };
