// Builds positions for the reworked Sneaky Checks: the king is in DOUBLE
// check (so it must move), several flight squares look playable, and exactly
// one of them ends the attack outright — after it the attacker has no check
// at all. Every other square lets the checks continue.
//
// That needs real legal move generation, not the pattern matcher the tagging
// version used: "can the attacker still give check from here?" means
// generating every legal attacker reply and testing each one. The generator
// below is perft-verified against Stockfish before any position ships.
//
// Functions between the ENGINE markers are copied verbatim into
// wavys-chess-prep.html.
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

/* ===== ENGINE START (mirrored into the app) ===== */
const DN_OFF=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const DDIAG=[[1,1],[1,-1],[-1,1],[-1,-1]];
const DORTH=[[1,0],[-1,0],[0,1],[0,-1]];

function dIdxRC(i){ return [Math.floor(i/8), i%8]; }
function dRcIdx(r,c){ return r*8+c; }
function dOn(r,c){ return r>=0&&r<8&&c>=0&&c<8; }
function dRand(n){ return Math.floor(Math.random()*n); }
function dPick(a){ return a[dRand(a.length)]; }
function dOpp(c){ return c==='w'?'b':'w'; }

function dPathClear(board, fr,fc, sR,sC, dist){
  for(let i=1;i<dist;i++){ if(board[dRcIdx(fr+sR*i, fc+sC*i)]) return false; }
  return true;
}
function dAttacks(board, from, piece, to){
  if(from===to) return false;
  const [fr,fc]=dIdxRC(from), [tr,tc]=dIdxRC(to);
  const dr=tr-fr, dc=tc-fc;
  switch(piece.type){
    case 'n': return DN_OFF.some(([a,b])=>a===dr&&b===dc);
    case 'k': return Math.max(Math.abs(dr),Math.abs(dc))===1;
    case 'p': { const dir = piece.color==='w'?1:-1; return dr===dir && Math.abs(dc)===1; }
    case 'b': { if(Math.abs(dr)!==Math.abs(dc)||dr===0) return false; return dPathClear(board,fr,fc,Math.sign(dr),Math.sign(dc),Math.abs(dr)); }
    case 'r': { if((dr===0)===(dc===0)) return false; const sR=dr===0?0:Math.sign(dr), sC=dc===0?0:Math.sign(dc); return dPathClear(board,fr,fc,sR,sC,Math.max(Math.abs(dr),Math.abs(dc))); }
    case 'q': { const diag=Math.abs(dr)===Math.abs(dc)&&dr!==0, str=(dr===0)!==(dc===0); if(!diag&&!str) return false; const sR=dr===0?0:Math.sign(dr), sC=dc===0?0:Math.sign(dc); return dPathClear(board,fr,fc,sR,sC,Math.max(Math.abs(dr),Math.abs(dc))); }
  }
  return false;
}
function dAttackersOf(board, sq, color){
  const res=[];
  for(let i=0;i<64;i++){ const p=board[i]; if(!p||p.color!==color) continue; if(dAttacks(board,i,p,sq)) res.push(i); }
  return res;
}
function dFindKing(board,color){
  for(let i=0;i<64;i++){ const p=board[i]; if(p&&p.type==='k'&&p.color===color) return i; }
  return -1;
}
function dApply(board, m){
  const n=board.slice();
  const p=n[m.from];
  n[m.to] = m.promo ? {type:m.promo, color:p.color} : p;
  n[m.from]=null;
  return n;
}
function dPushPawn(out, from, to, promo){
  if(promo){ ['q','r','b','n'].forEach(t=>out.push({from,to,promo:t})); }
  else out.push({from,to});
}
// Pseudo-legal: no castling and no en passant, because every position this
// file ships is written with neither right available.
function dPseudo(board, color){
  const out=[];
  for(let i=0;i<64;i++){
    const p=board[i]; if(!p||p.color!==color) continue;
    const [r,c]=dIdxRC(i);
    if(p.type==='p'){
      const dir = color==='w'?1:-1, start = color==='w'?1:6, last = color==='w'?7:0;
      if(dOn(r+dir,c) && !board[dRcIdx(r+dir,c)]){
        dPushPawn(out, i, dRcIdx(r+dir,c), r+dir===last);
        if(r===start && !board[dRcIdx(r+2*dir,c)]) out.push({from:i, to:dRcIdx(r+2*dir,c)});
      }
      for(const dc of [-1,1]){
        if(!dOn(r+dir,c+dc)) continue;
        const t=dRcIdx(r+dir,c+dc);
        if(board[t] && board[t].color!==color) dPushPawn(out, i, t, r+dir===last);
      }
    } else if(p.type==='n'){
      for(const [dr,dc] of DN_OFF){
        if(!dOn(r+dr,c+dc)) continue;
        const t=dRcIdx(r+dr,c+dc);
        if(!board[t] || board[t].color!==color) out.push({from:i,to:t});
      }
    } else if(p.type==='k'){
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
        if(!dr&&!dc) continue;
        if(!dOn(r+dr,c+dc)) continue;
        const t=dRcIdx(r+dr,c+dc);
        if(!board[t] || board[t].color!==color) out.push({from:i,to:t});
      }
    } else {
      const dirs = p.type==='b' ? DDIAG : p.type==='r' ? DORTH : DDIAG.concat(DORTH);
      for(const [dr,dc] of dirs){
        let rr=r+dr, cc=c+dc;
        while(dOn(rr,cc)){
          const t=dRcIdx(rr,cc);
          if(!board[t]) out.push({from:i,to:t});
          else { if(board[t].color!==color) out.push({from:i,to:t}); break; }
          rr+=dr; cc+=dc;
        }
      }
    }
  }
  return out;
}
function dInCheck(board, color){
  const k=dFindKing(board,color);
  return k>=0 && dAttackersOf(board,k,dOpp(color)).length>0;
}
function dLegal(board, color){
  return dPseudo(board,color).filter(m=>{
    const nb=dApply(board,m);
    const k=dFindKing(nb,color);
    return k>=0 && dAttackersOf(nb,k,dOpp(color)).length===0;
  });
}
function dGivesCheck(board, m, mover){
  return dInCheck(dApply(board,m), dOpp(mover));
}

/* The drill's whole premise, expressed as a filter. */
function dAnalyse(board, defColor){
  const atk = dOpp(defColor);
  const king = dFindKing(board, defColor);
  if(king<0 || dFindKing(board,atk)<0) return null;
  if(dInCheck(board, atk)) return null;                  // attacker can't also be in check
  const checkers = dAttackersOf(board, king, atk);
  if(checkers.length!==2) return null;                   // double check forces a king move
  const legal = dLegal(board, defColor);
  if(legal.length<3) return null;                        // a choice worth making
  if(legal.some(m=>m.from!==king)) return null;          // sanity: only king moves exist

  const safe=[], unsafe=[];
  for(const m of legal){
    const nb = dApply(board, m);
    const replies = dLegal(nb, atk);
    if(replies.length===0) continue;                     // stalemate isn't "safe", it's a fluke
    const checks = replies.filter(r=>dGivesCheck(nb, r, atk));
    if(checks.length===0) safe.push(m.to);
    else unsafe.push({ to:m.to, by:checks[0].from, at:checks[0].to, count:checks.length });
  }
  // Exactly one square ends the attack; every other flight square lets it run.
  if(safe.length!==1) return null;
  if(unsafe.length !== legal.length-1) return null;
  return { king, checkers, safe:safe[0], unsafe, flights:legal.map(m=>m.to) };
}

const DEFENCE_BANDS = {
  easy:   { extra:[1,2], defenders:[0,1] },
  medium: { extra:[2,3], defenders:[0,2] },
  hard:   { extra:[3,5], defenders:[1,3] }
};

function dGenerate(difficulty){
  const cfg = DEFENCE_BANDS[difficulty] || DEFENCE_BANDS.medium;
  for(let attempt=0; attempt<900; attempt++){
    const defColor = Math.random()<0.5 ? 'w' : 'b';
    const atk = dOpp(defColor);
    const board = new Array(64).fill(null);

    // Put the defending king somewhere with room to run.
    const kr = 1+dRand(6), kc = 1+dRand(6);
    const king = dRcIdx(kr,kc);
    board[king] = {type:'k', color:defColor};

    // Two attackers, placed so each genuinely checks the king.
    const types = [dPick(['n','b','r','q']), dPick(['n','b','r','q'])];
    let placed = 0;
    for(const t of types){
      const spots=[];
      for(let i=0;i<64;i++){
        if(board[i]) continue;
        const [r]=dIdxRC(i);
        if(t==='p' && (r===0||r===7)) continue;
        if(dAttacks(board, i, {type:t,color:atk}, king)) spots.push(i);
      }
      if(!spots.length) break;
      board[dPick(spots)] = {type:t, color:atk};
      placed++;
    }
    if(placed!==2) continue;
    if(dAttackersOf(board, king, atk).length!==2) continue;   // blockers may have spoiled it

    // Attacking king, clear of the action.
    const farSpots=[];
    for(let i=0;i<64;i++){
      if(board[i]) continue;
      const [r,c]=dIdxRC(i);
      if(Math.max(Math.abs(r-kr),Math.abs(c-kc))<=2) continue;
      farSpots.push(i);
    }
    if(!farSpots.length) continue;
    board[dPick(farSpots)] = {type:'k', color:atk};

    // Extra attackers are what make the other flight squares unsafe.
    const [emin,emax]=cfg.extra;
    const nExtra = emin + dRand(emax-emin+1);
    for(let n=0;n<nExtra;n++){
      const empties=[];
      for(let i=0;i<64;i++) if(!board[i]) empties.push(i);
      if(!empties.length) break;
      const sq=dPick(empties);
      const [r]=dIdxRC(sq);
      const t = (r===0||r===7) ? dPick(['n','b','r','q']) : dPick(['p','n','b','r','q']);
      board[sq] = {type:t, color:atk};
      if(dAttackersOf(board, king, atk).length!==2) board[sq]=null;   // mustn't add a third checker
    }

    // A few defenders for texture. They can never block a double check, but
    // they do change which squares the king can use.
    const [dmin,dmax]=cfg.defenders;
    const nDef = dmin + dRand(dmax-dmin+1);
    for(let n=0;n<nDef;n++){
      const empties=[];
      for(let i=0;i<64;i++) if(!board[i]) empties.push(i);
      if(!empties.length) break;
      const sq=dPick(empties);
      const [r]=dIdxRC(sq);
      const t = (r===0||r===7) ? dPick(['n','b','r']) : dPick(['p','n','b','r']);
      board[sq] = {type:t, color:defColor};
      if(dAttackersOf(board, king, atk).length!==2) board[sq]=null;
    }

    for(let i=0;i<64;i++){
      const p=board[i]; if(!p||p.type!=='p') continue;
      const [r]=dIdxRC(i); if(r===0||r===7){ board[i]=null; }
    }

    const info = dAnalyse(board, defColor);
    if(!info) continue;
    return { board, defColor, atkColor:atk, ...info };
  }
  return null;
}
/* ===== ENGINE END ===== */

function toFEN(board, side){
  const rows=[];
  for(let r=7;r>=0;r--){
    let row='', empty=0;
    for(let c=0;c<8;c++){
      const p=board[dRcIdx(r,c)];
      if(!p){ empty++; continue; }
      if(empty){ row+=empty; empty=0; }
      row += p.color==='w' ? p.type.toUpperCase() : p.type;
    }
    if(empty) row+=empty;
    rows.push(row);
  }
  return rows.join('/')+' '+side+' - - 0 1';
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

async function perft1(engine, fen){
  engine.write('position fen '+fen);
  const lines = await engine.cmd('go perft 1', l=>l.startsWith('Nodes searched'));
  const n = lines.find(l=>l.startsWith('Nodes searched'));
  return parseInt(n.split(':')[1].trim(), 10);
}

async function main(){
  const want = parseInt(process.argv[2],10) || 120;
  const engine = createEngine();
  await engine.cmd('uci', l=>l==='uciok');
  await engine.cmd('isready', l=>l==='readyok');

  const pool=[];
  let perftChecked=0, perftOk=0, genFail=0;
  const perftBad=[];
  const tally={};

  for(const difficulty of ['easy','medium','hard']){
    for(let i=0;i<Math.ceil(want/3);i++){
      const pos = dGenerate(difficulty);
      if(!pos){ genFail++; continue; }
      const fen = toFEN(pos.board, pos.defColor);

      // Perft the position itself: with the defender in double check this is
      // exactly the king-evasion generation the drill depends on.
      const mine = dLegal(pos.board, pos.defColor).length;
      const theirs = await perft1(engine, fen);
      perftChecked++;
      if(mine===theirs) perftOk++;
      else if(perftBad.length<5) perftBad.push({fen, mine, theirs, stage:'root'});

      // And perft every position the king can move to, since "are there still
      // checks here?" is answered from those.
      let childOk = true;
      for(const m of dLegal(pos.board, pos.defColor)){
        const nb = dApply(pos.board, m);
        const cf = toFEN(nb, pos.atkColor);
        const cm = dLegal(nb, pos.atkColor).length;
        const ct = await perft1(engine, cf);
        perftChecked++;
        if(cm===ct) perftOk++;
        else { childOk=false; if(perftBad.length<5) perftBad.push({fen:cf, mine:cm, theirs:ct, stage:'child'}); }
      }
      if(!childOk) continue;

      tally[difficulty]=(tally[difficulty]||0)+1;
      pool.push({
        fen,
        side: pos.defColor,
        king: pos.king,
        checkers: pos.checkers,
        flights: pos.flights,
        safe: pos.safe,
        unsafe: pos.unsafe,
        difficulty
      });
    }
  }
  engine.write('quit');

  console.log('positions kept:', pool.length);
  console.log('generator failures:', genFail);
  console.log('perft positions checked vs Stockfish:', perftChecked);
  console.log('perft agreement:', perftOk, perftOk===perftChecked ? '(all)' : '*** MISMATCH ***');
  console.log('mix:', JSON.stringify(tally));
  const flightSpread={};
  pool.forEach(p=>{ flightSpread[p.flights.length]=(flightSpread[p.flights.length]||0)+1; });
  console.log('flight-square counts:', JSON.stringify(flightSpread));
  if(perftBad.length) console.log('perft mismatches:', JSON.stringify(perftBad,null,1));

  fs.writeFileSync(path.join(__dirname,'curated_pool_defence.json'), JSON.stringify(pool));
  console.log('wrote curated_pool_defence.json');
  setTimeout(()=>process.exit(perftOk===perftChecked?0:1), 200);
}
main();
