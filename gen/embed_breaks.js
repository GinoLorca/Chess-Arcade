const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'wavys-chess-prep.html');
const poolPath = path.join(__dirname, 'curated_pool_breaks.json');

const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
const html = fs.readFileSync(htmlPath, 'utf8');

const startMarker = 'const BREAKS_POOL_DATA = ';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) {
  console.error('Marker not found — did the surrounding code change?');
  process.exit(1);
}
const endIdx = html.indexOf(';\n', startIdx);

const replacement = 'const BREAKS_POOL_DATA = ' + JSON.stringify(pool);
const next = html.slice(0, startIdx) + replacement + html.slice(endIdx);
fs.writeFileSync(htmlPath, next);
console.log('Embedded', pool.length, 'curated pawn-break positions (' + (replacement.length/1024).toFixed(1) + ' KB) into wavys-chess-prep.html');
