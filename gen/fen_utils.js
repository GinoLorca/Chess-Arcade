function idxRC(i){ return [Math.floor(i/8), i%8]; }
function rcIdx(r,c){ return r*8+c; }
function sqToIdx(sq){
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return rcIdx(rank, file);
}
function idxToSq(idx){
  const [r,c] = idxRC(idx);
  return 'abcdefgh'[c] + (r+1);
}
function boardFromFEN(fen){
  const [placement, side] = fen.split(' ');
  const board = new Array(64).fill(null);
  const rows = placement.split('/');
  for(let i=0;i<8;i++){
    const rank = 7 - i;
    let file = 0;
    for(const ch of rows[i]){
      if(/[1-8]/.test(ch)){ file += Number(ch); }
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase();
        board[rcIdx(rank,file)] = {type, color};
        file++;
      }
    }
  }
  return { board, side };
}
function nonKingPieceCount(board){
  return board.filter(p => p && p.type !== 'k').length;
}
module.exports = { idxRC, rcIdx, sqToIdx, idxToSq, boardFromFEN, nonKingPieceCount };
