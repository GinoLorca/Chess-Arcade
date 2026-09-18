// Generates "kiss of death" positions (white queen delivering a CONTACT check
// orthogonally adjacent to the black king) and cross-checks this file's own
// mate verdict against real Stockfish for every single one.
//
// The functions between the MOTIF-ENGINE markers are copied verbatim into
// wavys-chess-prep.html, so passing this script verifies the shipped code,
// not a parallel reimplementation.
const { spawn } = require('child_process');
const readline = require('readline');

/* ===== MOTIF-ENGINE START (mirrored into the app) ===== */
const KISS_KNIGHT_OFFSETS=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
function kIdxRC(i){ return [Math.floor(i/8), i%8]; }
function kRcIdx(r,c){ return r*8+c; }
function kOn(r,c){ return r>=0&&r<8&&c>=0&&c<8; }
function kRand(n){ return Math.floor(Math.random()*n); }
function kPick(a){ return a[kRand(a.length)]; }

function kPathClear(board, fr,fc, sR,sC, dist){
  for(let i=1;i<dist;i++){ if(board[kRcIdx(fr+sR*i, fc+sC*i)]) return false; }
  return true;
}
function kAttacks(board, fromIdx, piece, toIdx){
  if(fromIdx===toIdx) return false;
  const [fr,fc]=kIdxRC(fromIdx), [tr,tc]=kIdxRC(toIdx);
  const dr=tr-fr, dc=tc-fc;
  switch(piece.type){
    case 'n': return KISS_KNIGHT_OFFSETS.some(([a,b])=>a===dr&&b===dc);
    case 'k': return Math.max(Math.abs(dr),Math.abs(dc))===1;
    case 'p': { const dir = piece.color==='w' ? 1 : -1; return dr===dir && Math.abs(dc)===1; }
    case 'b': { if(Math.abs(dr)!==Math.abs(dc)||dr===0) return false; return kPathClear(board,fr,fc,Math.sign(dr),Math.sign(dc),Math.abs(dr)); }
    case 'r': { if((dr===0)===(dc===0)) return false; const sR=dr===0?0:Math.sign(dr), sC=dc===0?0:Math.sign(dc); return kPathClear(board,fr,fc,sR,sC,Math.max(Math.abs(dr),Math.abs(dc))); }
    case 'q': { const diag=Math.abs(dr)===Math.abs(dc)&&dr!==0, str=(dr===0)!==(dc===0); if(!diag&&!str) return false; const sR=dr===0?0:Math.sign(dr), sC=dc===0?0:Math.sign(dc); return kPathClear(board,fr,fc,sR,sC,Math.max(Math.abs(dr),Math.abs(dc))); }
  }
  return false;
}
function kAttackersOf(board, target, color){
  const res=[];
  for(let i=0;i<64;i++){ const p=board[i]; if(!p||p.color!==color) continue; if(kAttacks(board,i,p,target)) res.push(i); }
  return res;
}
function kFindKing(board,color){
  for(let i=0;i<64;i++){ const p=board[i]; if(p&&p.type==='k'&&p.color===color) return i; }
  return -1;
}
function kMove(board, from, to){ const n=board.slice(); n[to]=n[from]; n[from]=null; return n; }

// Every legal way Black can answer the check. King moves are simulated so a
// sliding checker correctly "sees through" the square the king just left —
// that is exactly why the king may not retreat straight back along the
// checking line.
function kBlackEscapes(board){
  const bk=kFindKing(board,'b');
  const [kr,kc]=kIdxRC(bk);
  const outs=[];
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
    if(!dr&&!dc) continue;
    const r=kr+dr,c=kc+dc; if(!kOn(r,c)) continue;
    const t=kRcIdx(r,c), occ=board[t];
    if(occ&&occ.color==='b') continue;
    if(kAttackersOf(kMove(board,bk,t),t,'w').length===0) outs.push({type:'king',to:t});
  }
  const checkers=kAttackersOf(board,bk,'w');
  if(checkers.length===1){
    const cs=checkers[0];
    for(let i=0;i<64;i++){
      const p=board[i]; if(!p||p.color!=='b'||p.type==='k') continue;
      if(!kAttacks(board,i,p,cs)) continue;
      const nb=kMove(board,i,cs);
      if(kAttackersOf(nb,kFindKing(nb,'b'),'w').length===0) outs.push({type:'capture',from:i,to:cs});
    }
    const cp=board[cs];
    if(cp.type==='r'||cp.type==='b'||cp.type==='q'){
      const [cr,cc]=kIdxRC(cs);
      const sR=Math.sign(kr-cr), sC=Math.sign(kc-cc);
      const dist=Math.max(Math.abs(kr-cr),Math.abs(kc-cc));
      for(let s=1;s<dist;s++){
        const bsq=kRcIdx(cr+sR*s, cc+sC*s);
        if(board[bsq]) continue;
        for(let i=0;i<64;i++){
          const p=board[i]; if(!p||p.color!=='b'||p.type==='k') continue;
          let can=false;
          if(p.type==='p'){
            const [pr,pc]=kIdxRC(i), [br,bc]=kIdxRC(bsq);
            if(pc===bc){
              if(br===pr-1) can=true;
              else if(pr===6&&br===4&&!board[kRcIdx(5,pc)]) can=true;
            }
          } else can = kAttacks(board,i,p,bsq);
          if(!can) continue;
          const nb=kMove(board,i,bsq);
          if(kAttackersOf(nb,kFindKing(nb,'b'),'w').length===0) outs.push({type:'block',from:i,to:bsq});
        }
      }
    }
  }
  return outs;
}
function kIsMate(board){
  const bk=kFindKing(board,'b');
  if(kAttackersOf(board,bk,'w').length===0) return false;
  return kBlackEscapes(board).length===0;
}

// Squares from which a piece of `type`/`color` would attack `target`.
function kSourcesAttacking(board, target, type, color){
  const out=[];
  for(let i=0;i<64;i++){
    if(board[i]) continue;
    const [r]=kIdxRC(i);
    if(type==='p' && (r===0||r===7)) continue;
    if(kAttacks(board,i,{type,color},target)) out.push(i);
  }
  return out;
}

const KISS_BANDS = {
  easy:   { decoys:[0,1], coverPrefersOccupy:0.5 },
  medium: { decoys:[2,4], coverPrefersOccupy:0.35 },
  hard:   { decoys:[5,8], coverPrefersOccupy:0.25 }
};

// Builds one motif position. wantMate decides whether every flight square is
// sealed (mate) or exactly one is left open (escape).
function kGenerate(difficulty, wantMate){
  const cfg = KISS_BANDS[difficulty] || KISS_BANDS.medium;
  for(let attempt=0; attempt<400; attempt++){
    const board = new Array(64).fill(null);
    const kr=kRand(8), kc=kRand(8);
    const bk=kRcIdx(kr,kc);
    const [dr,dc]=kPick([[1,0],[-1,0],[0,1],[0,-1]]);
    if(!kOn(kr+dr,kc+dc)) continue;
    const q=kRcIdx(kr+dr,kc+dc);
    board[bk]={type:'k',color:'b'};
    board[q]={type:'q',color:'w'};

    // With only K+Q on the board these are precisely the motif's flight squares.
    const flights=[];
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){
      if(!a&&!b) continue;
      const r=kr+a,c=kc+b; if(!kOn(r,c)) continue;
      const t=kRcIdx(r,c); if(t===q) continue;
      if(kAttackersOf(kMove(board,bk,t),t,'w').length===0) flights.push(t);
    }
    if(flights.length===0) continue;           // back-rank case: no decision to train
    if(!wantMate && flights.length<1) continue;

    // The queen must be defended, or the king simply takes it.
    const defType = kPick(['r','b','n','p','k']);
    const defSquares = kSourcesAttacking(board, q, defType, 'w')
      .filter(s=> defType!=='k' ? true : Math.max(...[0].map(()=>0))===0);
    if(defSquares.length===0) continue;
    const defSq = kPick(defSquares);
    if(defType==='k'){
      const [dr2,dc2]=kIdxRC(defSq);
      if(Math.max(Math.abs(dr2-kr),Math.abs(dc2-kc))<=1) continue;   // kings may not touch
    }
    board[defSq]={type:defType,color:'w'};

    // Seal the flight squares (all of them for mate; all but one otherwise).
    const leaveOpen = wantMate ? -1 : kPick(flights);
    let sealFailed=false;
    for(const s of flights){
      if(s===leaveOpen) continue;
      if(Math.random()<cfg.coverPrefersOccupy){
        // Black's own piece clogging the square counts as sealed.
        const [sr]=kIdxRC(s);
        const t = (sr===0||sr===7) ? kPick(['n','b','r']) : kPick(['p','n','b','r']);
        board[s]={type:t,color:'b'};
      } else {
        const t = kPick(['r','b','n','p']);
        const srcs = kSourcesAttacking(board, s, t, 'w');
        if(srcs.length===0){ sealFailed=true; break; }
        board[kPick(srcs)]={type:t,color:'w'};
      }
    }
    if(sealFailed) continue;

    if(kFindKing(board,'w')<0){
      // White still needs a king somewhere harmless.
      const spots=[];
      for(let i=0;i<64;i++){
        if(board[i]) continue;
        const [r,c]=kIdxRC(i);
        if(Math.max(Math.abs(r-kr),Math.abs(c-kc))<=1) continue;
        spots.push(i);
      }
      if(spots.length===0) continue;
      board[kPick(spots)]={type:'k',color:'w'};
    }

    if(!kValid(board, q, wantMate)) continue;

    // Decoys: extra pieces that must NOT change the verdict. This is where the
    // hard tier gets its bite — pieces that look like they cover a square but
    // whose line is blocked.
    const [dmin,dmax]=cfg.decoys;
    const nDecoys = dmin + kRand(dmax-dmin+1);
    for(let d=0; d<nDecoys; d++){
      const empties=[];
      for(let i=0;i<64;i++) if(!board[i]) empties.push(i);
      if(!empties.length) break;
      const sq=kPick(empties);
      const [r]=kIdxRC(sq);
      const color = Math.random()<0.5 ? 'w':'b';
      const type = (r===0||r===7) ? kPick(['n','b','r','q']) : kPick(['p','n','b','r','q']);
      board[sq]={type,color};
      if(!kValid(board, q, wantMate)) board[sq]=null;   // rejected, verdict changed
    }

    if(!kValid(board, q, wantMate)) continue;
    const kingEscapes = kBlackEscapes(board)
      .filter(e=>e.type==='king').map(e=>e.to);
    // A position can be "not mate" purely because some piece can capture the
    // queen, leaving the king itself with nowhere to run. Answering "escape"
    // there would be unwinnable — the drill then asks for a flight square
    // that does not exist — so those are not this drill's puzzles.
    if(!wantMate && kingEscapes.length===0) continue;
    return { board, kingIdx:bk, queenIdx:q, flights, isMate:wantMate,
             kingEscapes, defender:'b',
             openSquare: wantMate ? null : leaveOpen };
  }
  return null;
}

// A position only ships if it is legal, the queen is the sole checker, and the
// verdict is what we asked for.
function kValid(board, q, wantMate){
  const bk=kFindKing(board,'b'), wk=kFindKing(board,'w');
  if(bk<0||wk<0) return false;
  const [br,bc]=kIdxRC(bk), [wr,wc]=kIdxRC(wk);
  if(Math.max(Math.abs(br-wr),Math.abs(bc-wc))<=1) return false;
  if(kAttackersOf(board,wk,'b').length>0) return false;        // white to have just moved
  for(let i=0;i<64;i++){
    const p=board[i]; if(!p||p.type!=='p') continue;
    const [r]=kIdxRC(i); if(r===0||r===7) return false;
  }
  const checkers=kAttackersOf(board,bk,'w');
  if(checkers.length!==1||checkers[0]!==q) return false;        // queen alone gives check
  return kIsMate(board)===wantMate;
}
/* ===== MOTIF-ENGINE END ===== */

function toFEN(board){
  const rows=[];
  for(let r=7;r>=0;r--){
    let row='', empty=0;
    for(let c=0;c<8;c++){
      const p=board[kRcIdx(r,c)];
      if(!p){ empty++; continue; }
      if(empty){ row+=empty; empty=0; }
      row += p.color==='w' ? p.type.toUpperCase() : p.type;
    }
    if(empty) row+=empty;
    rows.push(row);
  }
  return rows.join('/')+' b - - 0 1';
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
    cmd:(c,isDone)=>new Promise((resolve)=>{ pendingResolve=resolve; doneCheck=isDone; proc.stdin.write(c+'\n'); })
  };
}

async function main(){
  const N = parseInt(process.argv[2],10) || 300;
  const engine = createEngine();
  await engine.cmd('uci', l=>l==='uciok');
  await engine.cmd('isready', l=>l==='readyok');

  let checked=0, agree=0;
  const disagreements=[];
  const tally={};

  for(const difficulty of ['easy','medium','hard']){
    for(const wantMate of [true,false]){
      for(let i=0;i<Math.ceil(N/6);i++){
        const pos = kGenerate(difficulty, wantMate);
        if(!pos){ tally[difficulty+'/genfail']=(tally[difficulty+'/genfail']||0)+1; continue; }
        const fen = toFEN(pos.board);

        engine.write('position fen '+fen);
        const perft = await engine.cmd('go perft 1', l=>l.startsWith('Nodes searched'));
        const nodesLine = perft.find(l=>l.startsWith('Nodes searched'));
        const legalMoves = parseInt(nodesLine.split(':')[1].trim(), 10);

        engine.write('position fen '+fen);
        const dLines = await engine.cmd('d', l=>l.startsWith('Checkers:'));
        const checkers = dLines.find(l=>l.startsWith('Checkers:')).replace('Checkers:','').trim();

        const sfInCheck = checkers.length>0;
        const sfMate = sfInCheck && legalMoves===0;

        checked++;
        const key = difficulty+'/'+(wantMate?'mate':'escape');
        tally[key]=(tally[key]||0)+1;

        // Stockfish must agree on BOTH the mate verdict and, for escapes, the
        // exact number of legal replies our own escape finder reports.
        const myEscapes = kBlackEscapes(pos.board).length;
        const verdictOk = (sfMate === pos.isMate) && sfInCheck && (legalMoves === myEscapes);
        if(verdictOk) agree++;
        else if(disagreements.length<5){
          disagreements.push({ fen, difficulty, wantMate, sfMate, myMate:pos.isMate, legalMoves, myEscapes, checkers });
        }
      }
    }
  }

  engine.write('quit');
  console.log('positions checked against Stockfish:', checked);
  console.log('exact agreement (mate verdict AND legal-reply count):', agree);
  console.log('disagreements:', checked-agree);
  console.log('mix:', JSON.stringify(tally));
  if(disagreements.length) console.log('samples:', JSON.stringify(disagreements,null,1));
  setTimeout(()=>process.exit(checked===agree?0:1), 200);
}
main();
