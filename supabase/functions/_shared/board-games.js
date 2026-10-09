// Small deterministic-friendly room games. State is JSON-safe so it can be synchronized by the room API.
export const BOARD_GAME_KINDS = ['snakes', 'ludo', 'carrom', 'blackjack', 'chess'];
export const BOARD_GAME_LABELS = {
  snakes: 'Snakes and Ladders', ludo: 'Ludo', carrom: 'Carrom', blackjack: 'Blackjack', chess: 'Chess',
};

export const SNAKES_AND_LADDERS = {
  2: 38, 7: 14, 8: 31, 15: 26, 16: 6, 21: 42, 28: 84, 36: 44,
  46: 25, 49: 11, 51: 67, 62: 19, 64: 60, 71: 91, 74: 53,
  78: 98, 87: 94, 89: 68, 92: 88, 95: 75, 99: 80,
};
const SAFE_LUDO_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const makePlayers = count => Array.from({ length: count }, (_, i) => ({ seat: i + 1, score: 0 }));
const nextSeat = (seat, count) => (seat % count) + 1;
const assertTurn = (state, seat) => {
  if (state.winner || state.finished) throw new Error('game_finished');
  if (Number(state.turnSeat) !== Number(seat)) throw new Error('not_your_turn');
};
const die = (random = Math.random) => Math.min(6, Math.max(1, 1 + Math.floor(random() * 6)));

export function createBoardState(kind, seatCount = 2, random = Math.random, options = {}) {
  const count = Math.max(1, Math.min(kind === 'ludo' ? 4 : kind === 'snakes' ? 4 : 2, Number(seatCount) || 2));
  const players = makePlayers(count).map(p => options.colors?.[p.seat] ? { ...p, color: options.colors[p.seat] } : p);
  if (kind === 'snakes') return { kind, players: players.map(p => ({ ...p, position: 0 })), turnSeat: 1, lastRoll: null, winner: null };
  if (kind === 'ludo') return { kind, players: players.map(p => ({ ...p, tokens: [-1, -1, -1, -1] })), turnSeat: 1, pendingRoll: null, winner: null };
  if (kind === 'carrom') {
    const spots = [[.5,.46],[.46,.5],[.54,.5],[.5,.54],[.465,.465],[.535,.465],[.465,.535],[.535,.535]];
    const coins = spots.map(([x,y], i) => ({ id: `coin-${i + 1}`, owner: count === 1 ? 1 : i % 2 + 1, x, y, pocketed: false }));
    return { kind, players, coins, turnSeat: 1, striker: { x: .5, y: .88 }, winner: null, lastPocketed: [] };
  }
  if (kind === 'blackjack') {
    const deck = [];
    for (const suit of ['♠','♥','♦','♣']) for (const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K']) deck.push(`${rank}${suit}`);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const state = { kind, players: players.map(p => ({ ...p, hand: [], stood: false, bust: false })), dealer: [], deck, drawAt: 0, turnSeat: 1, winner: null, finished: false };
    for (let round = 0; round < 2; round++) {
      for (const p of state.players) p.hand.push(deck[state.drawAt++]);
      state.dealer.push(deck[state.drawAt++]);
    }
    return state;
  }
  if (kind === 'chess') {
    const colors = options.colors || {}, whiteSeat = Number(Object.keys(colors).find(seat => colors[seat] === 'white')) || 1;
    const blackSeat = Number(Object.keys(colors).find(seat => colors[seat] === 'black')) || 2;
    return {
      kind,
      board: [
        ['r','n','b','q','k','b','n','r'], Array(8).fill('p'), Array(8).fill(''), Array(8).fill(''),
        Array(8).fill(''), Array(8).fill(''), Array(8).fill('P'), ['R','N','B','Q','K','B','N','R'],
      ],
      players, turnSeat: whiteSeat, colorSeats: { white: whiteSeat, black: blackSeat }, castling: { K: true, Q: true, k: true, q: true }, enPassant: null, winner: null, finished: false,
    };
  }
  throw new Error('unsupported_game');
}

function legalLudoTokens(player, roll) {
  return player.tokens.map((position, token) => ({ position, token }))
    .filter(({ position }) => position < 57 && (position >= 0 || roll === 6) && (position < 0 || position + roll <= 57))
    .map(({ token }) => token);
}

function blackjackValue(hand) {
  let total = 0, aces = 0;
  for (const card of hand || []) {
    const rank = String(card).slice(0, -1);
    if (rank === 'A') { total += 11; aces++; }
    else total += ['K','Q','J'].includes(rank) ? 10 : Number(rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function settleBlackjack(state) {
  while (blackjackValue(state.dealer) < 17 && state.drawAt < state.deck.length) state.dealer.push(state.deck[state.drawAt++]);
  const dealer = blackjackValue(state.dealer);
  for (const player of state.players) {
    const score = blackjackValue(player.hand);
    player.score = score <= 21 && (dealer > 21 || score > dealer) ? 1 : score === dealer && score <= 21 ? 0 : -1;
  }
  state.finished = true;
  state.winner = state.players.find(p => p.score === 1)?.seat ?? (state.players.every(p => p.score === 0) ? 0 : -1);
  return state;
}

// ---- Chess rules (legal moves include check, checkmate, castling and promotion) -------------------
const KNIGHT_STEPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_STEPS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const inside = (r,c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const isWhite = piece => !!piece && piece === piece.toUpperCase();
const enemyAt = (board,r,c,white) => inside(r,c) && board[r][c] && isWhite(board[r][c]) !== white;
const friendlyAt = (board,r,c,white) => inside(r,c) && board[r][c] && isWhite(board[r][c]) === white;

export function isSquareAttacked(board, row, col, byWhite) {
  const pawnFromRow = row + (byWhite ? 1 : -1);
  for (const dc of [-1,1]) if (inside(pawnFromRow,col+dc) && board[pawnFromRow][col+dc] === (byWhite ? 'P' : 'p')) return true;
  for (const [dr,dc] of KNIGHT_STEPS) if (inside(row+dr,col+dc) && board[row+dr][col+dc] === (byWhite ? 'N' : 'n')) return true;
  for (const [dr,dc] of KING_STEPS) if (inside(row+dr,col+dc) && board[row+dr][col+dc] === (byWhite ? 'K' : 'k')) return true;
  const rays = [
    { steps: [[-1,0],[1,0],[0,-1],[0,1]], pieces: byWhite ? ['R','Q'] : ['r','q'] },
    { steps: [[-1,-1],[-1,1],[1,-1],[1,1]], pieces: byWhite ? ['B','Q'] : ['b','q'] },
  ];
  for (const ray of rays) for (const [dr,dc] of ray.steps) {
    let r = row + dr, c = col + dc;
    while (inside(r,c)) {
      const p = board[r][c];
      if (p) { if (ray.pieces.includes(p)) return true; break; }
      r += dr; c += dc;
    }
  }
  return false;
}
function kingPosition(board, white) {
  const target = white ? 'K' : 'k';
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (board[r][c] === target) return [r,c];
  return null;
}
export function inCheck(board, white) {
  const king = kingPosition(board, white);
  return !!king && isSquareAttacked(board, king[0], king[1], !white);
}
function pseudoChessMoves(state, from) {
  const [r,c] = from, board = state.board, piece = board[r]?.[c];
  if (!piece) return [];
  const white = isWhite(piece), type = piece.toLowerCase(), moves = [];
  const add = (toR,toC,extra={}) => { if (inside(toR,toC) && !friendlyAt(board,toR,toC,white) && !['K','k'].includes(board[toR][toC])) moves.push({ from:[r,c], to:[toR,toC], ...extra }); };
  if (type === 'p') {
    const dir = white ? -1 : 1, start = white ? 6 : 1;
    if (inside(r+dir,c) && !board[r+dir][c]) {
      add(r+dir,c);
      if (r === start && !board[r+2*dir][c]) add(r+2*dir,c);
    }
    for (const dc of [-1,1]) {
      if (enemyAt(board,r+dir,c+dc,white)) add(r+dir,c+dc);
      else if (state.enPassant && state.enPassant[0] === r+dir && state.enPassant[1] === c+dc) add(r+dir,c+dc,{enPassant:true});
    }
  } else if (type === 'n') {
    for (const [dr,dc] of KNIGHT_STEPS) add(r+dr,c+dc);
  } else if (type === 'k') {
    for (const [dr,dc] of KING_STEPS) add(r+dr,c+dc);
    const home = white ? 7 : 0, rights = state.castling || {};
    if (r === home && c === 4 && !inCheck(board,white)) {
      const short = white ? 'K' : 'k', long = white ? 'Q' : 'q';
      if (rights[short] && !board[home][5] && !board[home][6] && board[home][7] === (white ? 'R' : 'r')
        && !isSquareAttacked(board,home,5,!white) && !isSquareAttacked(board,home,6,!white)) add(home,6,{castle:'short'});
      if (rights[long] && !board[home][1] && !board[home][2] && !board[home][3] && board[home][0] === (white ? 'R' : 'r')
        && !isSquareAttacked(board,home,3,!white) && !isSquareAttacked(board,home,2,!white)) add(home,2,{castle:'long'});
    }
  } else {
    const dirs = type === 'b' ? [[-1,-1],[-1,1],[1,-1],[1,1]]
      : type === 'r' ? [[-1,0],[1,0],[0,-1],[0,1]]
      : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr,dc] of dirs) {
      let nr=r+dr,nc=c+dc;
      while (inside(nr,nc)) {
        if (friendlyAt(board,nr,nc,white)) break;
        if (!['K','k'].includes(board[nr][nc])) moves.push({ from:[r,c], to:[nr,nc] });
        if (board[nr][nc]) break;
        nr+=dr;nc+=dc;
      }
    }
  }
  return moves;
}
function applyChessUnchecked(state, move) {
  const next = { ...state, board: state.board.map(row => [...row]), castling: { ...state.castling } };
  const [[fromR,fromC],[toR,toC]] = [move.from,move.to];
  const piece = next.board[fromR][fromC];
  if (!piece) throw new Error('invalid_move');
  if (move.enPassant) next.board[fromR][toC] = '';
  next.board[fromR][fromC] = '';
  next.board[toR][toC] = piece;
  if (move.castle) {
    const row=fromR, short=move.castle==='short', rookFrom=short?7:0, rookTo=short?5:3;
    next.board[row][rookTo] = next.board[row][rookFrom]; next.board[row][rookFrom] = '';
  }
  if (piece === 'P' && toR === 0) next.board[toR][toC] = 'Q';
  if (piece === 'p' && toR === 7) next.board[toR][toC] = 'q';
  if (piece === 'K') { next.castling.K=false; next.castling.Q=false; }
  if (piece === 'k') { next.castling.k=false; next.castling.q=false; }
  if (fromR===7&&fromC===0 || toR===7&&toC===0) next.castling.Q=false;
  if (fromR===7&&fromC===7 || toR===7&&toC===7) next.castling.K=false;
  if (fromR===0&&fromC===0 || toR===0&&toC===0) next.castling.q=false;
  if (fromR===0&&fromC===7 || toR===0&&toC===7) next.castling.k=false;
  next.enPassant = piece.toLowerCase()==='p'&&Math.abs(toR-fromR)===2 ? [(toR+fromR)/2,toC] : null;
  return next;
}
export function legalChessMoves(state, from) {
  if (!Array.isArray(from)||from.length!==2||!inside(Number(from[0]),Number(from[1]))) return [];
  const piece=state.board?.[from[0]]?.[from[1]];
  if (!piece) return [];
  const white=isWhite(piece);
  return pseudoChessMoves(state,from).filter(move => {
    const next=applyChessUnchecked(state,move);
    return !inCheck(next.board,white);
  });
}
function chessHasMove(state,white) {
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.board[r][c]&&isWhite(state.board[r][c])===white&&legalChessMoves(state,[r,c]).length)return true;
  return false;
}
function moveChess(state, seat, action) {
  const white=Number(state.colorSeats?.white ?? 1)===Number(seat);
  if (Number(state.turnSeat)!==seat) throw new Error('not_your_turn');
  const from=action.from?.map(Number), to=action.to?.map(Number);
  const move=legalChessMoves(state,from).find(m=>m.to[0]===to?.[0]&&m.to[1]===to?.[1]);
  if(!move) throw new Error('illegal_chess_move');
  const next=applyChessUnchecked(state,move), opponent=!white;
  next.turnSeat=nextSeat(seat,2);
  const checked=inCheck(next.board,opponent), hasMove=chessHasMove(next,opponent);
  let announcement=`${white?'White':'Black'} moved ${String.fromCharCode(97+from[1])}${8-from[0]} to ${String.fromCharCode(97+to[1])}${8-to[0]}.`;
  if(!hasMove){
    next.finished=true;
    next.winner=checked?seat:0;
    announcement=checked?`Checkmate. ${white?'White':'Black'} wins.`:'Stalemate. The game is a draw.';
  }else if(checked) announcement+=' Check.';
  next.lastMove={from,to,capture:!!state.board[to[0]][to[1]],check:checked};
  return {state:next,announcement,sfx:state.board[to[0]][to[1]]?'coin':'click',finished:next.finished};
}

// Basic equal-mass 2D collision and pocket simulation for a turn-based carrom shot.
function simulateCarrom(state, seat, aim, power) {
  const angle=Number(aim)*Math.PI/180, strength=Math.max(.3,Math.min(1,Number(power)||.6));
  const striker={x:.5,y:seat===1?.88:.12,vx:Math.sin(angle)*strength*.032,vy:-Math.cos(angle)*strength*.032,r:.032};
  const coins=(state.coins||[]).filter(c=>!c.pocketed).map(c=>({...c,vx:0,vy:0,r:.022}));
  const balls=[striker,...coins], pockets=[[.05,.05],[.95,.05],[.05,.95],[.95,.95]];
  for(let step=0;step<500;step++){
    for(const ball of balls){
      if(ball.pocketed)continue;
      ball.x+=ball.vx;ball.y+=ball.vy;
      for(const [px,py] of pockets) if(Math.hypot(ball.x-px,ball.y-py)<.075){ball.pocketed=true;ball.vx=ball.vy=0;break;}
      if(ball.pocketed)continue;
      if(ball.x<ball.r){ball.x=ball.r;ball.vx=Math.abs(ball.vx)*.82}if(ball.x>1-ball.r){ball.x=1-ball.r;ball.vx=-Math.abs(ball.vx)*.82}
      if(ball.y<ball.r){ball.y=ball.r;ball.vy=Math.abs(ball.vy)*.82}if(ball.y>1-ball.r){ball.y=1-ball.r;ball.vy=-Math.abs(ball.vy)*.82}
    }
    for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
      const a=balls[i],b=balls[j];if(a.pocketed||b.pocketed)continue;
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),min=a.r+b.r;if(!dist||dist>=min)continue;
      const nx=dx/dist,ny=dy/dist,overlap=min-dist;a.x-=nx*overlap/2;a.y-=ny*overlap/2;b.x+=nx*overlap/2;b.y+=ny*overlap/2;
      const av=a.vx*nx+a.vy*ny,bv=b.vx*nx+b.vy*ny,diff=(av-bv);
      a.vx-=diff*nx;a.vy-=diff*ny;b.vx+=diff*nx;b.vy+=diff*ny;
    }
    let moving=false;
    for(const ball of balls)if(!ball.pocketed){ball.vx*=.987;ball.vy*=.987;if(Math.hypot(ball.vx,ball.vy)>.0006)moving=true;else ball.vx=ball.vy=0;}
    if(!moving)break;
  }
  const pocketed=[];
  for(const coin of coins){
    const original=state.coins.find(c=>c.id===coin.id);
    if(coin.pocketed){pocketed.push(coin.id);if(original?.owner===seat)state.players[seat-1].score++;}
    else Object.assign(original,{x:coin.x,y:coin.y});
  }
  state.coins=state.coins.map(c=>pocketed.includes(c.id)?{...c,pocketed:true}:c);
  state.lastPocketed=pocketed;
  state.striker={x:.5,y:seat===1?.88:.12};
  if(state.coins.every(c=>c.pocketed)){state.finished=true;const [a,b]=state.players;state.winner=!b?1:a.score===b.score?0:a.score>b.score?a.seat:b.seat;}
  else if(!pocketed.some(id=>state.coins.find(c=>c.id===id)?.owner===seat))state.turnSeat=nextSeat(seat,state.players.length);
  return {state,announcement:pocketed.length?`${pocketed.length} coin${pocketed.length===1?'':'s'} pocketed.`:'No coin pocketed. Next turn.',sfx:pocketed.length?'coin':'click',finished:!!state.finished};
}

export function reduceBoardGame(kind, inputState, seat, action, random = Math.random) {
  const state=structuredClone(inputState);
  seat=Number(seat);
  if(!action||typeof action!=='object')throw new Error('invalid_action');
  if(kind==='snakes'){
    assertTurn(state,seat);
    if(action.type!=='roll')throw new Error('invalid_action');
    const roll=Number.isInteger(Number(action.value))&&Number(action.value)>=1&&Number(action.value)<=6?Number(action.value):die(random);
    const player=state.players[seat-1],from=player.position;let to=from+roll,special='';
    if(to>100)to=from;
    if(SNAKES_AND_LADDERS[to]){const dest=SNAKES_AND_LADDERS[to];special=dest>to?`ladder to ${dest}`:`snake to ${dest}`;to=dest;}
    player.position=to;player.score=to;state.lastRoll={seat,roll,from,to,special};
    if(to===100){state.winner=seat;state.finished=true;}else state.turnSeat=nextSeat(seat,state.players.length);
    return {state,announcement:`Player ${seat} rolled ${roll} and moved to ${to}${special?`, a ${special}`:''}.`,sfx:'click',sounds:['tick','click'],finished:!!state.finished};
  }
  if(kind==='ludo'){
    if(action.type==='roll'){
      assertTurn(state,seat);if(state.pendingRoll)throw new Error('choose_token_first');
      const roll=Number.isInteger(Number(action.value))&&Number(action.value)>=1&&Number(action.value)<=6?Number(action.value):die(random);
      const available=legalLudoTokens(state.players[seat-1],roll);state.pendingRoll=roll;
      if(!available.length){state.pendingRoll=null;state.turnSeat=nextSeat(seat,state.players.length);return {state,announcement:`Player ${seat} rolled ${roll}. No token can move.`,sfx:'tick'};}
      return {state,announcement:`Player ${seat} rolled ${roll}. Choose a token to move.`,sfx:'tick',availableTokens:available};
    }
    if(action.type==='move'){
      assertTurn(state,seat);const token=Number(action.token),roll=Number(state.pendingRoll);if(!roll||!legalLudoTokens(state.players[seat-1],roll).includes(token))throw new Error('illegal_token_move');
      const player=state.players[seat-1],from=player.tokens[token];let to=from<0?0:from+roll;player.tokens[token]=to;
      const track=(seat-1)*13+(to%52),captured=[];
      if(to<52&&!SAFE_LUDO_SQUARES.has(track))for(const opponent of state.players)if(opponent.seat!==seat)for(let i=0;i<opponent.tokens.length;i++)if(opponent.tokens[i]>=0&&opponent.tokens[i]<52&&((opponent.seat-1)*13+opponent.tokens[i]%52)===track){opponent.tokens[i]=-1;captured.push(opponent.seat);}
      const six=roll===6;state.pendingRoll=null;
      if(player.tokens.every(pos=>pos===57)){state.winner=seat;state.finished=true;}
      else if(!six)state.turnSeat=nextSeat(seat,state.players.length);
      return {state,announcement:`Player ${seat} moved token ${token+1}${captured.length?` and sent a token home`:''}.`,sfx:captured.length?'coin':'click',finished:!!state.finished};
    }
    throw new Error('invalid_action');
  }
  if(kind==='carrom'){
    assertTurn(state,seat);if(action.type!=='strike')throw new Error('invalid_action');
    return simulateCarrom(state,seat,action.aim,action.power);
  }
  if(kind==='blackjack'){
    assertTurn(state,seat);const player=state.players[seat-1];
    if(action.type==='hit'){
      if(player.stood||player.bust)throw new Error('invalid_action');
      player.hand.push(state.deck[state.drawAt++]);player.bust=blackjackValue(player.hand)>21;
      if(player.bust)player.stood=true;
    }else if(action.type==='stand')player.stood=true;else throw new Error('invalid_action');
    const next=state.players.find(p=>p.seat>seat&&!p.stood&&!p.bust)||state.players.find(p=>!p.stood&&!p.bust);
    if(next)state.turnSeat=next.seat;else{settleBlackjack(state);}
    const finished=!!state.finished;
    return {state,announcement:finished?`Dealer has ${blackjackValue(state.dealer)}. Round complete.`:action.type==='hit'?`Player ${seat} draws a card.`:`Player ${seat} stands.`,sfx:finished?'coin':'click',finished};
  }
  if(kind==='chess'){
    assertTurn(state,seat);if(action.type!=='move')throw new Error('invalid_action');return moveChess(state,seat,action);
  }
  throw new Error('unsupported_game');
}

export function blackjackValueForTest(hand) { return blackjackValue(hand); }
