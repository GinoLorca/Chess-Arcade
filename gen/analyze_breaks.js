// Curates raw self-play pawn-break candidates into a final pool: dedupes,
// subsamples for a manageable grading budget, then runs real Stockfish
// MultiPV analysis on each survivor to grade every candidate quiet pawn
// push against Stockfish's own evaluation. MultiPV is set high enough that
// every legal move (not just the engine's top few) gets its own eval, since
// a candidate pawn push might not otherwise crack the top N.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { boardFromFEN, nonKingPieceCount } = require('./fen_utils');

const GEN_DIR = __dirname;
const TARGET_TOTAL = parseInt(process.argv[2], 10) || 220;
// A curated puzzle should have a genuinely correct answer: the best pawn
// push must be within this many centipawns of the engine's true best move
// overall, or "the best break" isn't actually a good idea in that position.
const MAX_GAP_TO_OVERALL_BEST = 100;
// Among the pawn-push candidates themselves, anything within this tolerance
// of the top one also counts as "best" (near-equally good alternative
// breaks are common in real chess — reward finding any of them).
const BEST_TOLERANCE = 25;
// Reject positions where too many candidates tie for "best" — if most of
// the options are fine, there's no real "which break is best" decision to
// train. Keep puzzles where the field is meaningfully split.
const MAX_BEST_COUNT = 3;
const MAX_BEST_FRACTION = 0.4;

function loadCandidates() {
  const files = fs.readdirSync(GEN_DIR).filter(f => /^breaks_candidates_\d+\.jsonl$/.test(f));
  const seen = new Map();
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

function pickSubsample(candidates) {
  const arr = candidates.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, TARGET_TOTAL);
}

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
  engine.write('setoption name MultiPV value 60');
  engine.write('position fen ' + fen);
  const lines = await engine.cmd('go movetime 800', (l) => l.startsWith('bestmove'));
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
  const overallBestPseudo = Math.max(...entries.map(e => pseudoCp(e.score)));
  return { entries, overallBestPseudo };
}

async function main() {
  console.log('Loading candidates...');
  const raw = loadCandidates();
  console.log('Raw unique candidates:', raw.length);

  const subsample = pickSubsample(raw);
  console.log('Subsampled for analysis:', subsample.length);

  const engine = createEngine();
  await engine.cmd('uci', (l) => l === 'uciok');
  engine.write('setoption name Threads value 4');
  await engine.cmd('isready', (l) => l === 'readyok');

  const final = [];
  let processed = 0;
  for (const cand of subsample) {
    const graded = await gradePosition(engine, cand.fen);
    processed++;
    if (processed % 20 === 0) console.log('Graded', processed, '/', subsample.length);
    if (!graded) continue;

    const { entries, overallBestPseudo } = graded;
    const byMove = new Map(entries.map(e => [e.move, pseudoCp(e.score)]));
    const pawnEntries = cand.pawnPushes
      .filter(uci => byMove.has(uci))
      .map(uci => ({ uci, cp: byMove.get(uci) }));
    // Every candidate needs at least 2 pawn pushes with a real eval to be a
    // genuine "which is better" decision; MultiPV=60 should cover this
    // almost always, but a position with an unusually high branching factor
    // could still leave a push or two unranked.
    if (pawnEntries.length < 2) continue;

    const bestPawnPseudo = Math.max(...pawnEntries.map(e => e.cp));
    if ((overallBestPseudo - bestPawnPseudo) > MAX_GAP_TO_OVERALL_BEST) continue;

    const bestCount = pawnEntries.filter(e => (bestPawnPseudo - e.cp) <= BEST_TOLERANCE).length;
    if (bestCount > MAX_BEST_COUNT) continue;
    if (bestCount / pawnEntries.length > MAX_BEST_FRACTION) continue;

    const { board, side } = boardFromFEN(cand.fen);
    const responses = pawnEntries.map(e => ({
      from: e.uci.slice(0, 2),
      to: e.uci.slice(2, 4),
      best: (bestPawnPseudo - e.cp) <= BEST_TOLERANCE
    }));

    final.push({
      fen: cand.fen,
      side,
      pieceCount: nonKingPieceCount(board),
      responses
    });
  }
  engine.write('quit');

  console.log('Final curated positions:', final.length);
  const bestCounts = final.map(c => c.responses.filter(r => r.best).length);
  const singleBest = bestCounts.filter(n => n === 1).length;
  const multiBest = bestCounts.filter(n => n >= 2).length;
  console.log('Positions with exactly one best break:', singleBest, '/ with 2+ near-equal best breaks:', multiBest);
  const sideCounts = {};
  final.forEach(c => { sideCounts[c.side] = (sideCounts[c.side] || 0) + 1; });
  console.log('Side distribution:', sideCounts);

  fs.writeFileSync(path.join(GEN_DIR, 'curated_pool_breaks.json'), JSON.stringify(final));
  console.log('Wrote curated_pool_breaks.json');
  setTimeout(() => process.exit(0), 200);
}

main();
