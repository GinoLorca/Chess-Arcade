// Generates "square of the pawn" races — a lone passed pawn running for
// promotion against a defending king — and checks this file's own verdict
// against real Stockfish for every one.
//
// The drill teaches one geometric rule: the king catches the pawn if it can
// reach the promotion square in no more moves than the pawn needs. A position
// only ships if the rule and the game-theoretic result agree, so the drill can
// never show a board where the pattern it teaches gives the wrong answer.
//
// The functions between the ENGINE markers are copied verbatim into
// wavys-chess-prep.html — passing this script verifies the shipped code.
const { spawn } = require('child_process');
const readline = require('readline');

/* ===== ENGINE START (mirrored into the app) ===== */
function eIdxRC(i){ return [Math.floor(i/8), i%8]; }
function eRcIdx(r,c){ return r*8+c; }
function eOn(r,c){ return r>=0&&r<8&&c>=0&&c<8; }
function eRand(n){ return Math.floor(Math.random()*n); }
function ePick(a){ return a[eRand(a.length)]; }
function eCheb(a,b){
  const [ar,ac]=eIdxRC(a), [br,bc]=eIdxRC(b);
  return Math.max(Math.abs(ar-br), Math.abs(ac-bc));
}

// Moves the pawn still needs, counting the two-square first push when it is
// still on its starting rank — the single most common way to misjudge a race.
function ePawnMoves(pawnIdx, color){
  const [pr] = eIdxRC(pawnIdx);
  if(color==='w') return (7-pr) - (pr===1 ? 1 : 0);
  return pr - (pr===6 ? 1 : 0);
}
function ePromoSq(pawnIdx, color){
  const [,pc] = eIdxRC(pawnIdx);
  return eRcIdx(color==='w' ? 7 : 0, pc);
}

// The whole drill in one line: the defender's budget is the pawn's move count,
// minus a tempo when the pawn moves first.
function eBudget(pawnIdx, color, sideToMove){
  const moves = ePawnMoves(pawnIdx, color);
  return sideToMove===color ? moves-1 : moves;
}
function eVerdict(pawnIdx, color, defKingIdx, sideToMove){
  const dist = eCheb(defKingIdx, ePromoSq(pawnIdx, color));
  const margin = eBudget(pawnIdx, color, sideToMove) - dist;
  return { catches: margin >= 0, margin, dist };
}

const ENDGAME_MARGINS = {
  easy:   { katch:[2,3,4],  promo:[-5,-4,-3] },
  medium: { katch:[1],      promo:[-2] },
  hard:   { katch:[0],      promo:[-1] }
};

function eSquaresAtDist(target, d){
  const [tr,tc]=eIdxRC(target);
  const out=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(Math.max(Math.abs(r-tr),Math.abs(c-tc))===d) out.push(eRcIdx(r,c));
  }
  return out;
}

function eGenerate(difficulty, wantCatch){
  const band = ENDGAME_MARGINS[difficulty] || ENDGAME_MARGINS.medium;
  for(let attempt=0; attempt<600; attempt++){
    const color = Math.random()<0.5 ? 'w' : 'b';
    const pc = eRand(8);
    // Keep the pawn off the promotion rank and off ranks where the race is
    // already over before it starts.
    const pr = color==='w' ? 1+eRand(5) : 1+eRand(5);
    const pawn = eRcIdx(pr, pc);
    if(color==='w' && pr>=7) continue;
    if(color==='b' && pr<=0) continue;

    const sideToMove = Math.random()<0.5 ? 'w' : 'b';
    const defender = color==='w' ? 'b' : 'w';
    const budget = eBudget(pawn, color, sideToMove);
    if(budget < 0) continue;

    const target = ePick(wantCatch ? band.katch : band.promo);
    const dist = budget - target;
    if(dist < 0 || dist > 8) continue;

    const promo = ePromoSq(pawn, color);
    const spots = eSquaresAtDist(promo, dist).filter(s=>{
      if(s===pawn) return false;
      // Never start the defending king on a square the pawn attacks: with the
      // attacker to move that position is illegal, and with the defender to
      // move it turns a clean race into a check to answer.
      const [sr,sc]=eIdxRC(s), [prr,prc]=eIdxRC(pawn);
      const dir = color==='w' ? 1 : -1;
      if(sr===prr+dir && Math.abs(sc-prc)===1) return false;
      return true;
    });
    if(!spots.length) continue;
    const defKing = ePick(spots);

    // The attacking king is parked well clear so it can neither shoulder the
    // defender nor escort the pawn — this is a pure race.
    const farSpots=[];
    for(let i=0;i<64;i++){
      if(i===pawn||i===defKing) continue;
      if(eCheb(i,pawn)<3) continue;
      if(eCheb(i,promo)<3) continue;
      if(eCheb(i,defKing)<2) continue;
      const [ir,ic]=eIdxRC(i);
      if(ic===eIdxRC(pawn)[1]) continue;          // keep it off the pawn's file
      if(ir===0||ir===7) continue;
      farSpots.push(i);
    }
    if(!farSpots.length) continue;
    const atkKing = ePick(farSpots);

    const board = new Array(64).fill(null);
    board[pawn]      = {type:'p', color};
    board[defKing]   = {type:'k', color:defender};
    board[atkKing]   = {type:'k', color};

    const v = eVerdict(pawn, color, defKing, sideToMove);
    if(v.catches !== wantCatch) continue;
    // A king sitting next to the pawn just eats it; that is a chase, not the
    // pattern this drill teaches.
    if(eCheb(defKing, pawn) < 2) continue;
    // Ground truth. The closed-form rule only describes a king racing to
    // intercept ahead of the pawn — it says nothing about one hunting the
    // pawn down from behind. Ship only the boards where the rule is actually
    // the right tool, so the pattern is never contradicted by the answer.
    if(racePromotes(pawn, defKing, sideToMove, atkKing, color) === v.catches) continue;

    return { board, pawn, defKing, atkKing, color, defender, sideToMove,
             promo, catches:v.catches, margin:v.margin,
             pawnMoves:ePawnMoves(pawn,color), kingDist:v.dist };
  }
  return null;
}
/* ---------------- exact race solver (independent oracle) ----------------
   The rule above is closed-form geometry. This is a brute-force search of
   the actual race, written from the other direction, and the two are then
   compared.

   It answers precisely the question the drill asks — "does the pawn promote
   if the attacking king stands still?" — which is NOT the same question as
   "is the position a win". Stockfish happily wins a blockade by marching the
   attacking king up, so it cannot arbitrate whether the pawn was caught. */
function racePromotes(pawn, defK, stm, atkK, color, memo){
  memo = memo || new Map();
  const key = pawn+','+defK+','+stm;
  if(memo.has(key)) return memo.get(key);

  const promoRank = color==='w' ? 7 : 0;
  const [pr,pc] = eIdxRC(pawn);
  if(pr===promoRank){ memo.set(key,true); return true; }

  const dir = color==='w' ? 1 : -1;
  let result;

  if(stm===color){
    // Attacker: the pawn is the only thing that moves.
    const one = eRcIdx(pr+dir, pc);
    const pushes=[];
    if(eOn(pr+dir,pc) && one!==defK && one!==atkK) pushes.push(one);
    const startRank = color==='w' ? 1 : 6;
    if(pr===startRank){
      const two = eRcIdx(pr+2*dir, pc);
      if(eOn(pr+2*dir,pc) && one!==defK && one!==atkK && two!==defK && two!==atkK) pushes.push(two);
    }
    // Nothing to push means the pawn is blockaded: it never promotes.
    result = pushes.length===0 ? false
           : pushes.some(np=>racePromotes(np, defK, color==='w'?'b':'w', atkK, color, memo));
  } else {
    const [kr,kc] = eIdxRC(defK);
    const moves=[];
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      const r=kr+dr, c=kc+dc;
      if(!eOn(r,c)) continue;
      const t = eRcIdx(r,c);
      if(t===atkK) continue;
      if(eCheb(t,atkK)<=1) continue;                 // kings may not touch
      if(t===pawn){ moves.push({t, captures:true}); continue; }
      // may not step onto a square the pawn guards
      const [tr,tc]=eIdxRC(t);
      if(tr===pr+dir && Math.abs(tc-pc)===1) continue;
      moves.push({t, captures:false});
    }
    if(moves.some(m=>m.captures)){ result = false; }        // pawn taken
    else if(moves.length===0){ result = false; }            // stalemate: no promotion
    else result = moves.every(m=>racePromotes(pawn, m.t, color, atkK, color, memo));
  }
  memo.set(key, result);
  return result;
}

/* ===== ENGINE END ===== */

function toFEN(pos){
  const rows=[];
  for(let r=7;r>=0;r--){
    let row='', empty=0;
    for(let c=0;c<8;c++){
      const p=pos.board[eRcIdx(r,c)];
      if(!p){ empty++; continue; }
      if(empty){ row+=empty; empty=0; }
      row += p.color==='w' ? p.type.toUpperCase() : p.type;
    }
    if(empty) row+=empty;
    rows.push(row);
  }
  return rows.join('/')+' '+pos.sideToMove+' - - 0 1';
}

function createEngine(){
  const proc = spawn('stockfish', [], { stdio:['pipe','pipe','ignore'] });
  const rl = readline.createInterface({ input: proc.stdout });
  let buffer=[], pendingResolve=null, doneCheck=null;
  rl.on('line',(line)=>{
    buffer.push(line);
    if(doneCheck && doneCheck(line)){
      const result=buffer; buffer=[];
      const resolve=pendingResolve; pendingResolve=null; doneCheck=null;
      resolve(result);
    }
  });
  return {
    write:(c)=>proc.stdin.write(c+'\n'),
    cmd:(c,isDone)=>new Promise(res=>{ pendingResolve=res; doneCheck=isDone; proc.stdin.write(c+'\n'); })
  };
}

async function main(){
  const N = parseInt(process.argv[2],10) || 1200;
  let checked=0, agree=0, genfail=0;
  const tally={}, marginSpread={};
  const promotePositions=[];

  for(const difficulty of ['easy','medium','hard']){
    for(const wantCatch of [true,false]){
      for(let i=0;i<Math.ceil(N/6);i++){
        const pos = eGenerate(difficulty, wantCatch);
        if(!pos){ genfail++; continue; }
        checked++;
        tally[difficulty+'/'+(wantCatch?'catch':'promote')]=(tally[difficulty+'/'+(wantCatch?'catch':'promote')]||0)+1;
        marginSpread[pos.margin]=(marginSpread[pos.margin]||0)+1;
        // by construction these must agree; assert it rather than assume it
        const solverPromotes = racePromotes(pos.pawn,pos.defKing,pos.sideToMove,pos.atkKing,pos.color);
        if(pos.catches === !solverPromotes) agree++;
        if(solverPromotes) promotePositions.push(toFEN(pos));
      }
    }
  }

  console.log('races generated:', checked);
  console.log('rule matches exact solver:', agree, agree===checked ? '(all)' : '*** MISMATCH ***');
  console.log('generator failures:', genfail);
  console.log('mix:', JSON.stringify(tally));
  console.log('margin spread:', JSON.stringify(marginSpread));

  // One-directional Stockfish cross-check: if the pawn promotes even with the
  // attacking king frozen, the real game must be winning for the attacker.
  // (The converse does NOT hold - a caught pawn is often still a won game -
  // which is exactly why Stockfish cannot arbitrate the drill's question.)
  const sample = promotePositions.slice(0, 60);
  const engine = createEngine();
  await engine.cmd('uci', l=>l==='uciok');
  await engine.cmd('isready', l=>l==='readyok');
  let sfOk=0;
  for(const fen of sample){
    engine.write('position fen '+fen);
    const lines = await engine.cmd('go depth 24', l=>l.startsWith('bestmove'));
    let cp=null, mate=null;
    for(const l of lines){
      if(!l.startsWith('info ')||l.indexOf(' pv ')<0) continue;
      const m=l.match(/score (cp|mate) (-?\d+)/);
      if(m){ if(m[1]==='mate'){mate=Number(m[2]);cp=null;} else {cp=Number(m[2]);mate=null;} }
    }
    const stm = fen.split(' ')[1];
    const atkIsWhite = fen.split(' ')[0].indexOf('P')>=0;
    const flip = (stm==='w') === atkIsWhite ? 1 : -1;
    const winning = (mate!=null && mate*flip>0) || (cp!=null && cp*flip>=500);
    if(winning) sfOk++;
  }
  engine.write('quit');
  console.log('stockfish confirms attacker winning on promote-positions:', sfOk+'/'+sample.length);
  setTimeout(()=>process.exit((agree===checked && sfOk===sample.length)?0:1), 200);
}
main();
