// Curates the raw self-play check-candidates into a final pool: dedupes,
// balances checker-type distribution (knight-heavy, per the drill's focus),
// then runs real Stockfish MultiPV analysis on each survivor to grade every
// legal reply as safe/unsafe relative to Stockfish's own best line.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { rcIdx, sqToIdx, boardFromFEN, nonKingPieceCount } = require('./fen_utils');

const GEN_DIR = __dirname;
const TARGET_TOTAL = parseInt(process.argv[2], 10) || 220;
const TARGET_KNIGHT_SHARE = 0.5; // aim ~50% knight checks
const CAP_PER_OTHER_TYPE = 45;

function loadCandidates() {
  const files = fs.readdirSync(GEN_DIR).filter(f => /^candidates_\d+\.jsonl$/.test(f));
  const seen = new Map(); // fen -> candidate
  for (const f of files) {
    const lines = fs.readFileSync(path.join(GEN_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; }
      if (!obj.fen || seen.has(obj.fen)) continue;
      seen.set(obj.fen, obj);
    }
  }
  return Array.from(seen.values());
}

function classify(cand) {
  const { board, side } = boardFromFEN(cand.fen);
  const checkerIdx = sqToIdx(cand.checkerSquare);
  const checkerPiece = board[checkerIdx];
  if (!checkerPiece) return null;
  if (checkerPiece.color === side) return null; // sanity: checker must belong to the mover, not the defender
  return {
    fen: cand.fen,
    side, // defending color = side to move in this FEN
    checkerType: checkerPiece.type,
    pieceCount: nonKingPieceCount(board)
  };
}

function pickSubsample(classified) {
  const byType = {};
  for (const c of classified) {
    (byType[c.checkerType] = byType[c.checkerType] || []).push(c);
  }
  for (const t in byType) {
    // shuffle
    const arr = byType[t];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  const knightTarget = Math.round(TARGET_TOTAL * TARGET_KNIGHT_SHARE);
  const selected = [];
  const knights = (byType['n'] || []).slice(0, knightTarget);
  selected.push(...knights);
  const others = Object.keys(byType).filter(t => t !== 'n');
  const remaining = TARGET_TOTAL - selected.length;
  const perOther = Math.min(CAP_PER_OTHER_TYPE, Math.ceil(remaining / Math.max(1, others.length)));
  for (const t of others) {
    selected.push(...byType[t].slice(0, perOther));
  }
  return selected.slice(0, TARGET_TOTAL);
}

/* ---------- Stockfish MultiPV grading ---------- */

function createEngine() {
  const proc = spawn('stockfish', [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const rl = readline.createInterface({ input: proc.stdout });
  let buffer = [];
  let pendingResolve = null;
  let doneCheck = null;
  rl.on('line', (line) => {
    buffer.push(line);
    if (doneCheck && doneCheck(line)) {
      const result = buffer;
      buffer = [];
      const resolve = pendingResolve;
      pendingResolve = null;
      doneCheck = null;
      resolve(result);
    }
  });
  function write(command) { proc.stdin.write(command + '\n'); }
  function cmd(command, isDone) {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      doneCheck = isDone;
      proc.stdin.write(command + '\n');
    });
  }
  return { proc, write, cmd };
}

function pseudoCp(score) {
  if (score.mate != null) {
    return score.mate > 0 ? (100000 - score.mate * 100) : (-100000 - score.mate * 100);
  }
  return score.cp;
}

async function gradePosition(engine, fen) {
  engine.write('setoption name MultiPV value 20');
  engine.write('position fen ' + fen);
  const lines = await engine.cmd('go movetime 700', (l) => l.startsWith('bestmove'));
  const bestmoveLine = lines.find(l => l.startsWith('bestmove'));
  if (!bestmoveLine || bestmoveLine.includes('(none)')) return null;

  const byIdx = new Map();
  const re = /\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+)\b.*?\bpv (\S+)/;
  for (const line of lines) {
    if (!line.startsWith('info ')) continue;
    const m = line.match(re);
    if (!m) continue;
    const idx = Number(m[1]);
    const score = m[2] === 'cp' ? { cp: Number(m[3]) } : { mate: Number(m[3]) };
    byIdx.set(idx, { move: m[4], score });
  }
  if (byIdx.size === 0) return null;

  const entries = Array.from(byIdx.values());
  const bestPseudo = Math.max(...entries.map(e => pseudoCp(e.score)));
  const responses = entries.map(e => {
    const uci = e.move;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.length > 4 ? uci[4] : null;
    const safe = (bestPseudo - pseudoCp(e.score)) <= 120;
    return { from, to, promo, safe };
  });
  return responses;
}

async function main() {
  console.log('Loading candidates...');
  const raw = loadCandidates();
  console.log('Raw unique candidates:', raw.length);

  const classified = raw.map(classify).filter(Boolean);
  console.log('Classified (checker verified):', classified.length);

  const typeCounts = {};
  classified.forEach(c => { typeCounts[c.checkerType] = (typeCounts[c.checkerType]||0)+1; });
  console.log('Checker type distribution in raw pool:', typeCounts);

  const subsample = pickSubsample(classified);
  console.log('Subsampled for analysis:', subsample.length);
  const subTypeCounts = {};
  subsample.forEach(c => { subTypeCounts[c.checkerType] = (subTypeCounts[c.checkerType]||0)+1; });
  console.log('Subsample checker type distribution:', subTypeCounts);

  const engine = createEngine();
  await engine.cmd('uci', (l) => l === 'uciok');
  engine.write('setoption name Threads value 4');
  await engine.cmd('isready', (l) => l === 'readyok');

  const final = [];
  let processed = 0;
  for (const cand of subsample) {
    const responses = await gradePosition(engine, cand.fen);
    processed++;
    if (processed % 20 === 0) console.log('Graded', processed, '/', subsample.length);
    if (!responses || responses.length === 0) continue;
    const safeCount = responses.filter(r=>r.safe).length;
    final.push({
      fen: cand.fen,
      side: cand.side,
      checkerType: cand.checkerType,
      responses
    });
  }
  engine.write('quit');

  console.log('Final curated positions:', final.length);
  const finalTypeCounts = {};
  final.forEach(c => { finalTypeCounts[c.checkerType] = (finalTypeCounts[c.checkerType]||0)+1; });
  console.log('Final checker type distribution:', finalTypeCounts);
  const finalSideCounts = {};
  final.forEach(c => { finalSideCounts[c.side] = (finalSideCounts[c.side]||0)+1; });
  console.log('Final side distribution:', finalSideCounts);
  const zeroSafe = final.filter(c => !c.responses.some(r=>r.safe)).length;
  console.log('Positions with zero safe replies (no clean save exists):', zeroSafe);

  fs.writeFileSync(path.join(GEN_DIR, 'curated_pool.json'), JSON.stringify(final));
  console.log('Wrote curated_pool.json');
  setTimeout(()=>process.exit(0), 200);
}

main();
