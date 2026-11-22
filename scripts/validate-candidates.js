const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { generateBlock, inlineBlock } = require('./build-inline-data');

const root = path.resolve(__dirname, '..');
const axes = ['childcare', 'senior', 'transit', 'housing', 'industry', 'governance'];
const municipalities = new Set(['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市']);
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateSchema = ajv.compile(require('../data/candidates-2026.schema.json'));

function validateData(data) {
  const errors = [];
  if (!validateSchema(data)) {
    errors.push(...validateSchema.errors.map(error => `${error.instancePath || '/'} ${error.message}`));
  }
  // Semantic checks only operate on a structurally valid document.
  if (errors.length) return errors;
  const { cityOrder, cityBulletinUrls, issueMeta, candidates } = data;
  if (JSON.stringify(cityOrder) !== JSON.stringify(Object.keys(cityBulletinUrls))) {
    errors.push('cityOrder must equal cityBulletinUrls keys in order (22 cities)');
  }
  if (JSON.stringify(Object.keys(issueMeta)) !== JSON.stringify(axes)) {
    errors.push('issueMeta keys must match radar axes in order: ' + axes.join(', '));
  }
  for (const [city, url] of Object.entries(cityBulletinUrls)) {
    try {
      const pathname = decodeURIComponent(new URL(url).pathname);
      const category = municipalities.has(city) ? '03直轄市長' : '04縣市長';
      const office = city.endsWith('市') ? '市長' : '縣長';
      if (pathname !== `/01選舉公報/${category}/115年/${city}${office}.pdf`) {
        errors.push(`Bulletin URL city/category mismatch: ${city}`);
      }
    } catch (error) {
      errors.push(`Invalid bulletin URL for ${city}: ${error.message}`);
    }
  }
  const ids = new Set();
  const prefixes = new Map();
  const numbers = new Set();
  for (const candidate of candidates) {
    const { id, city, num } = candidate;
    if (!cityOrder.includes(city) || !Object.hasOwn(cityBulletinUrls, city)) {
      errors.push(`${id}: unknown city or missing bulletin URL: ${city}`);
    }
    if (ids.has(id)) errors.push(`Duplicate id: ${id}`);
    ids.add(id);
    const prefix = id.split('-')[0];
    if (prefixes.has(city) && prefixes.get(city) !== prefix) errors.push(`${id}: inconsistent id prefix for ${city}`);
    prefixes.set(city, prefix);
    const key = city + ':' + num;
    if (numbers.has(key)) errors.push(`Duplicate num in ${city}: ${num}`);
    numbers.add(key);
  }
  return errors;
}

function checkInline(data, html) {
  try {
    return inlineBlock(html).text === generateBlock(data) ? [] : ['Inline data is out of sync; run npm run build:data'];
  } catch (error) {
    return [error.message];
  }
}

async function main() {
  const flags = process.argv.slice(2);
  const unknown = flags.filter(flag => !['--check-inline', '--online'].includes(flag));
  if (unknown.length) throw new Error('Unknown flags: ' + unknown.join(', '));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/candidates-2026.json'), 'utf8'));
  const errors = validateData(data);
  if (flags.includes('--check-inline')) {
    errors.push(...checkInline(data, fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
  }
  if (flags.includes('--online') && !errors.length) {
    const results = await Promise.all(Object.entries(data.cityBulletinUrls).map(async ([city, url]) => {
      try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
        return response.ok ? null : `${city}: HTTP ${response.status}`;
      } catch (error) {
        return `${city}: ${error.message}`;
      }
    }));
    errors.push(...results.filter(Boolean));
  }
  if (errors.length) {
    console.error(errors.map(error => '- ' + error).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Valid data: ${data.candidates.length} candidates, ${data.cityOrder.length} counties`);
    if (flags.includes('--check-inline')) console.log('Inline data is in sync');
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { validateData, checkInline };
