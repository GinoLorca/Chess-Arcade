// Chess Arcade's quick scores (qk* in index.html) load Stockfish 16 through this: the very same engine file, only that its many
// short pauses (setTimeout 0, which browsers hold to 4 ms) are messages instead. At 12,000 nodes a position that is most of the
// waiting. Without this file (an older host, a copy without it) index.html loads the engine itself, a bit slower.
(function(){
  var T = self.setTimeout, q = [], c = new MessageChannel();
  c.port1.onmessage = function(){ var f = q.shift(); if(f) f(); };
  self.setTimeout = function(f, ms){
    if(ms || typeof f!=='function') return T.apply(self, arguments);
    q.push(f); c.port2.postMessage(0);
    return 0;
  };
  importScripts('stockfish-nnue-16-single.js');
})();
