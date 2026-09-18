const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'wavys-chess-prep.html');
const poolPath = path.join(__dirname, 'curated_pool.json');

const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
const html = fs.readFileSync(htmlPath, 'utf8');

const marker = 'const SAVE_POOL_DATA = [];';
if (!html.includes(marker)) {
  console.error('Marker not found — has the file already been embedded, or did the surrounding code change?');
  process.exit(1);
}

const replacement = 'const SAVE_POOL_DATA = ' + JSON.stringify(pool) + ';';
const next = html.replace(marker, replacement);
fs.writeFileSync(htmlPath, next);
console.log('Embedded', pool.length, 'curated positions (' + (replacement.length/1024).toFixed(1) + ' KB) into wavys-chess-prep.html');
