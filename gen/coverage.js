// Classifies the curated pool against the six "why did the natural king
// move fail" motifs, using authoritative Stockfish `d` output for the
// checker square (rather than re-deriving it) plus the pool's own
// already-graded responses.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { rcIdx, sqToIdx, boardFromFEN } = require('./fen_utils');

const pool = JSON.parse(fs.readFileSync(path.join(__dirname, 'curated_pool.json'), 'utf8'));

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

function findKingSq(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.type === 'k' && p.color === color) {
      const r = Math.floor(i / 8), c = i % 8;
      return 'abcdefgh'[c] + (r + 1);
    }
  }
  return null;
}

async function main() {
  const engine = createEngine();
  await engine.cmd('uci', (l) => l === 'uciok');
  await engine.cmd('isready', (l) => l === 'readyok');

  const stats = {
    total: 0,
    kingOnlyOptions: 0,       // knight-style: no capture-of-checker, no block possible
    hasSafeKingCapture: 0,    // king itself safely takes the checker
    hasSafeOtherCapture: 0,   // a different piece safely takes the checker
    hasSafeBlock: 0,          // interposition exists and is safe
    hasUnsafeBlockAlso: 0,    // a block exists but is NOT safe (so "interposition was weaker" cases too)
    hasUnsafeKingMove: 0,     // at least one king move is legal but unsafe (destination "looks" ok but isn't held)
    singleSafeAnswer: 0,      // exactly one safe reply — no room to relax
    multipleSafeAnswers: 0,   // 2+ safe replies — a check that's less dangerous than it looks
  };

  for (const pos of pool) {
    const { board, side } = boardFromFEN(pos.fen);
    const kingSq = findKingSq(board, side);

    const dLines = await engine.cmd('position fen ' + pos.fen + '\nd', (l) => l.startsWith('Checkers:'));
    const checkersLine = dLines.find((l) => l.startsWith('Checkers:'));
    const checkerSq = checkersLine.replace('Checkers:', '').trim().split(/\s+/)[0];

    let sawSafeKingCapture = false, sawSafeOtherCapture = false;
    let sawSafeBlock = false, sawUnsafeBlock = false;
    let sawUnsafeKingMove = false;
    let anyCaptureOrBlockOption = false;
    let safeCount = 0;

    for (const r of pos.responses) {
      const isKingMove = r.from === kingSq;
      const isCaptureChecker = r.to === checkerSq;
      const isBlock = !isKingMove && !isCaptureChecker;
      if (isCaptureChecker || isBlock) anyCaptureOrBlockOption = true;
      if (r.safe) safeCount++;

      if (isKingMove && isCaptureChecker && r.safe) sawSafeKingCapture = true;
      if (!isKingMove && isCaptureChecker && r.safe) sawSafeOtherCapture = true;
      if (isBlock && r.safe) sawSafeBlock = true;
      if (isBlock && !r.safe) sawUnsafeBlock = true;
      if (isKingMove && !isCaptureChecker && !r.safe) sawUnsafeKingMove = true;
    }

    stats.total++;
    if (!anyCaptureOrBlockOption) stats.kingOnlyOptions++;
    if (sawSafeKingCapture) stats.hasSafeKingCapture++;
    if (sawSafeOtherCapture) stats.hasSafeOtherCapture++;
    if (sawSafeBlock) stats.hasSafeBlock++;
    if (sawUnsafeBlock) stats.hasUnsafeBlockAlso++;
    if (sawUnsafeKingMove) stats.hasUnsafeKingMove++;
    if (safeCount === 1) stats.singleSafeAnswer++;
    if (safeCount >= 2) stats.multipleSafeAnswers++;
  }

  engine.write('quit');
  console.log(JSON.stringify(stats, null, 2));
  setTimeout(() => process.exit(0), 200);
}

main();
