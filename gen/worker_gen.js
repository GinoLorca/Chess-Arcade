// Plays Stockfish-vs-Stockfish self-play games at varied strength and logs
// every position where the side to move is in a single check (not mate),
// as JSONL candidates for later curation into the "Find the Save" drill.
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');

const [, , numGamesArg, outFileArg, workerIdArg] = process.argv;
const NUM_GAMES = parseInt(numGamesArg, 10) || 20;
const OUT_FILE = outFileArg || 'candidates.jsonl';
const WORKER_ID = workerIdArg || '0';

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
  function write(command) {
    proc.stdin.write(command + '\n');
  }
  function cmd(command, isDone) {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      doneCheck = isDone;
      proc.stdin.write(command + '\n');
    });
  }
  return { proc, write, cmd };
}

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function configureRandomStrength(engine) {
  const roll = Math.random();
  if (roll < 0.25) {
    // Full strength: cleaner, more "correct" positions.
    engine.write('setoption name UCI_LimitStrength value false');
  } else {
    const elo = randInt(1100, 2400);
    engine.write('setoption name UCI_LimitStrength value true');
    engine.write('setoption name UCI_Elo value ' + elo);
  }
  // setoption produces no output of its own; isready's readyok is the only
  // safe synchronization point (Stockfish processes commands in order).
  await engine.cmd('isready', (l) => l === 'readyok');
}

function parseCheckers(dLines) {
  const fenLine = dLines.find((l) => l.startsWith('Fen: '));
  const checkersLine = dLines.find((l) => l.startsWith('Checkers: '));
  const fen = fenLine ? fenLine.slice('Fen: '.length).trim() : null;
  const checkers = checkersLine ? checkersLine.slice('Checkers: '.length).trim() : '';
  return { fen, checkers };
}

async function playGame(engine, out) {
  engine.write('ucinewgame');
  await engine.cmd('isready', (l) => l === 'readyok');
  await configureRandomStrength(engine);

  const moves = [];
  const maxPlies = 100;
  for (let ply = 0; ply < maxPlies; ply++) {
    const posCmd = moves.length ? 'position startpos moves ' + moves.join(' ') : 'position startpos';
    engine.write(posCmd);
    const moveTime = randInt(40, 110);
    const goLines = await engine.cmd('go movetime ' + moveTime, (l) => l.startsWith('bestmove'));
    const bmLine = goLines.find((l) => l.startsWith('bestmove'));
    const bestMove = bmLine ? bmLine.split(/\s+/)[1] : null;
    if (!bestMove || bestMove === '(none)') break;
    moves.push(bestMove);

    engine.write('position startpos moves ' + moves.join(' '));
    const dLines = await engine.cmd('d', (l) => l.startsWith('Checkers:'));
    const { fen, checkers } = parseCheckers(dLines);
    if (fen && checkers) {
      const checkerSquares = checkers.trim().split(/\s+/).filter(Boolean);
      if (checkerSquares.length === 1) {
        out.write(JSON.stringify({ fen, checkerSquare: checkerSquares[0], ply, worker: WORKER_ID }) + '\n');
      }
    }
  }
}

async function main() {
  const engine = createEngine();
  await engine.cmd('uci', (l) => l === 'uciok');
  await engine.cmd('isready', (l) => l === 'readyok');
  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });

  for (let g = 0; g < NUM_GAMES; g++) {
    try {
      await playGame(engine, out);
    } catch (e) {
      // keep going even if one game errors
    }
    if (g % 10 === 0) {
      process.stderr.write('[worker ' + WORKER_ID + '] game ' + g + '/' + NUM_GAMES + '\n');
    }
  }
  out.end();
  engine.write('quit');
  setTimeout(() => process.exit(0), 200);
}

main();
