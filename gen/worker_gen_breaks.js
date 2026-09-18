// Plays Stockfish-vs-Stockfish self-play games at varied strength and logs
// every position (past the early opening) where the side to move has at
// least two legal QUIET pawn advances — candidate "which pawn break is
// best" puzzles for the Pawn Breaks drill. A quiet pawn advance is a legal
// pawn move that stays on the same file (dc===0), which cleanly excludes
// every kind of pawn capture (including en passant, which is diagonal too).
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');

const [, , numGamesArg, outFileArg, workerIdArg] = process.argv;
const NUM_GAMES = parseInt(numGamesArg, 10) || 20;
const OUT_FILE = outFileArg || 'breaks_candidates.jsonl';
const WORKER_ID = workerIdArg || '0';
const MIN_PLY = 16;

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

async function configureRandomStrength(engine) {
  const roll = Math.random();
  if (roll < 0.25) {
    engine.write('setoption name UCI_LimitStrength value false');
  } else {
    const elo = randInt(1100, 2400);
    engine.write('setoption name UCI_LimitStrength value true');
    engine.write('setoption name UCI_Elo value ' + elo);
  }
  await engine.cmd('isready', (l) => l === 'readyok');
}

function parseFenAndSide(dLines) {
  const fenLine = dLines.find((l) => l.startsWith('Fen: '));
  if (!fenLine) return null;
  const fen = fenLine.slice('Fen: '.length).trim();
  const side = fen.split(' ')[1];
  return { fen, side };
}

// Parses "go perft 1" output: one "e2e4: 1" line per legal move, ending
// with a blank line before "Nodes searched: N".
function parseLegalMoves(perftLines) {
  const moves = [];
  for (const line of perftLines) {
    const m = line.match(/^([a-h][1-8][a-h][1-8][nbrq]?):\s*\d+$/);
    if (m) moves.push(m[1]);
  }
  return moves;
}

// A quiet pawn push: the "from" square holds a pawn belonging to the side
// to move, and the move stays on the same file (rules out every capture,
// including en passant).
function quietPawnPushes(legalMoves, fen, side) {
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  const board = {}; // 'e4' -> 'P'/'p'
  for (let i = 0; i < 8; i++) {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (/[1-8]/.test(ch)) { file += Number(ch); }
      else { board['abcdefgh'[file] + rank] = ch; file++; }
    }
  }
  const wantPiece = side === 'w' ? 'P' : 'p';
  return legalMoves.filter((uci) => {
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    if (board[from] !== wantPiece) return false;
    return from[0] === to[0]; // same file = straight push, never a capture
  });
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

    if (ply + 1 >= MIN_PLY) {
      engine.write('position startpos moves ' + moves.join(' '));
      const dLines = await engine.cmd('d', (l) => l.startsWith('Checkers:'));
      const parsed = parseFenAndSide(dLines);
      if (parsed) {
        const perftLines = await engine.cmd('go perft 1', (l) => l.startsWith('Nodes searched'));
        const legalMoves = parseLegalMoves(perftLines);
        const pawnPushes = quietPawnPushes(legalMoves, parsed.fen, parsed.side);
        if (pawnPushes.length >= 2) {
          out.write(JSON.stringify({ fen: parsed.fen, ply: ply + 1, pawnPushes, worker: WORKER_ID }) + '\n');
        }
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
    if (g % 5 === 0) {
      process.stderr.write('[worker ' + WORKER_ID + '] game ' + g + '/' + NUM_GAMES + '\n');
    }
  }
  out.end();
  engine.write('quit');
  setTimeout(() => process.exit(0), 200);
}

main();
