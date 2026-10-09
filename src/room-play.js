import { presentQuestion, selectRoundQuestions } from './game-logic.js';
import { createBoardState, legalChessMoves, SNAKES_AND_LADDERS } from './board-games.js';

const POLL_MS=1500, HIDDEN_MS=12000, PIECES={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const UUID_SEED=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
function rngFor(key){let a=UUID_SEED(key);return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const deterministicShuffle=(items,random)=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const button=(text,handler,cls='button button-outline')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.addEventListener('click',handler);return b;};
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const pieceWhite=p=>p&&p===p.toUpperCase();

export function createRoomPlay({$,announce,callApi,getSession,go,questionBank,matchSounds=async()=>[],playMatchSound=()=>{},playSfx=()=>{},onBroadcast=()=>{},currentView=()=>'',refreshRoom=()=>{}}){
  let game=null,timer=null,afterId=null,firstPoll=true,joined=false,mySeat=0,host=false,canModerateComments=false,commentsAfter=0,replyTo=null,boardSelected=null,localQuestion=-1,questionLock=false,boardPending=false,wordPending=false,soundPending=false,scoreCache=[],roomMembers=[],commentsEnabled=true;
  const active=()=>!!game&&currentView()==='room-game';
  const pollDelay=()=>document.hidden?HIDDEN_MS:POLL_MS;
  const say=(text,urgent=false)=>{const el=$('#room-play-status');if(el)el.textContent=text;if(text)announce(text,urgent);};
  const errorText=code=>({not_your_turn:'It is another player’s turn.',illegal_chess_move:'That is not a legal chess move.',illegal_token_move:'That token cannot move with this roll.',choose_token_first:'Choose a token after rolling.',stale_action:'The board changed. Refreshing the match.',game_full:'There are no open player slots.',seat_taken:'That player slot is already taken.',players_not_ready:'Wait for every player to select Ready.',waiting_for_players:'Waiting for the other player to join.',match_unavailable:'This older game cannot be started here. Create a new room game.',game_finished:'This game has finished.',game_unavailable:'This game is no longer available.',not_friends:'You can invite friends to play. Send a friend request first.',player_unavailable:'No player with that name was found.',not_room_member:'That player is not currently in this room.',color_taken:'That color is already chosen by another player.',choose_color:'Every player must choose a unique game color first.',invalid_word:'That is not a word you can make from these letters.',comments_disabled:'Comments are turned off for this match.'}[code]||'Could not update this room game. Please try again.');

  function reset(){clearTimeout(timer);timer=null;game=null;joined=false;mySeat=0;host=false;canModerateComments=false;afterId=null;firstPoll=true;commentsAfter=0;replyTo=null;boardSelected=null;localQuestion=-1;questionLock=false;boardPending=false;wordPending=false;soundPending=false;scoreCache=[];roomMembers=[];commentsEnabled=true;$('#room-play-comments')?.replaceChildren();$('#room-play-board')?.replaceChildren();$('#room-play-controls')?.replaceChildren();$('#room-play-question')?.replaceChildren();$('#room-play-word-list')?.replaceChildren();$('#room-play-sound-grid')?.replaceChildren();$('#room-play-quiz').hidden=true;$('#room-play-letters').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=true;$('#room-play-lobby').hidden=true;$('#room-play-join-form').hidden=true;$('#room-play-comment-form').hidden=false;$('#room-play-comments-toggle-wrap').hidden=true;}
  function open(options={}){
    reset();game={...options,id:options.id||options.gameId,kind:options.kind||'quiz',config:options.config||{},title:options.title||'Room game'};
    joined=!!options.joined;mySeat=Number(options.seat)||0;host=!!options.host;canModerateComments=host||!!options.creatorMe;game.creatorMe=!!options.creatorMe;roomMembers=options.roomMembers||[];game.phase=options.phase||'lobby';game.maxPlayers=Number(options.maxPlayers)||Number(options.config?.players)||2;$('#room-play-title').textContent=game.title;$('#room-play-comments').replaceChildren();$('#room-play-status').textContent='Connecting to the match…';
    go('room-game',{focus:'#room-play-title'});
    if(joined)poll();else showSlotPicker(options.players||[],game.maxPlayers);
  }
  const colorsForGame=()=>game?.kind==='ludo'?['red','yellow','green','blue']:game?.kind==='chess'?['white','black']:[];
  function fillColors(select,players,ownSeat=0,current=''){
    const choices=colorsForGame();if(!select)return;
    const taken=new Set((players||[]).filter(p=>Number(p.seat)!==Number(ownSeat)&&p.color).map(p=>p.color));
    select.replaceChildren(node('option','','Choose a color'));
    select.options[0].value='';
    for(const color of choices)if(!taken.has(color)){const opt=node('option','',color[0].toUpperCase()+color.slice(1));opt.value=color;select.append(opt);}
    select.value=choices.includes(current)?current:'';
  }
  function showSlotPicker(players,maxPlayers){
    $('#room-play-lobby').hidden=true;$('#room-play-quiz').hidden=true;$('#room-play-letters').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=true;
    const form=$('#room-play-join-form'),select=$('#room-play-slot');
    form.hidden=false;select.replaceChildren();
    const occupied=new Set(players.map(p=>Number(p.seat)));
    for(let seat=1;seat<=maxPlayers;seat++)if(!occupied.has(seat)){const opt=node('option','',`Player ${seat}`);opt.value=String(seat);select.append(opt);}
    if(!select.options.length){form.hidden=true;say('This game has no open player slots. You can watch from the room.');return;}
    const colorOptions=colorsForGame(),colorSelect=$('#room-play-join-color');
    $('#room-play-join-color-label').hidden=!colorOptions.length;colorSelect.hidden=!colorOptions.length;
    if(colorOptions.length)fillColors(colorSelect,players,0,'');
    say(`Choose your player slot${colorOptions.length?' and color':''} to join ${game.title}. Questions stay hidden until the players are ready.`);
  }
  async function joinSelected(e){e.preventDefault();if(!game)return;const seat=Number($('#room-play-slot').value),color=colorsForGame().length?$('#room-play-join-color').value:null;if(colorsForGame().length&&!color)return say('Choose a color before joining.',true);$('#room-play-join').disabled=true;
    try{const d=await callApi('game-join',{gameId:game.id,seat,color});joined=true;mySeat=Number(d.seat)||seat;host=!!d.host;$('#room-play-join-form').hidden=true;say(`You joined as Player ${mySeat}${d.color?`, ${d.color}`:''}. Mark yourself Ready when you are set.`);poll();}
    catch(err){say(errorText(err.message),true);if(['seat_taken','game_full','game_started'].includes(err.message))poll();}
    finally{$('#room-play-join').disabled=false;}
  }
  function showPlayers(players,maxPlayers){
    scoreCache=players||[];
    const list=$('#room-play-players'),bySeat=new Map((players||[]).map(p=>[Number(p.seat),p]));
    const count=Math.max(1,Math.min(6,Number(maxPlayers)||players?.length||2));
    list.replaceChildren(...Array.from({length:count},(_,i)=>{const seat=i+1,p=bySeat.get(seat);const label=p?`Player ${seat}: ${p.name}${p.color?`, ${p.color}`:''}, ${p.ready?'Ready':'not ready'}${Number(p.score)?`, ${p.score} points`:''}`:`Player ${seat}: Waiting for a player`;const li=node('li',`room-play-player${p?.ready?' is-ready':''}`,label);li.dataset.seat=String(seat);return li;}));
    const lobby=game?.phase==='lobby',me=(players||[]).find(p=>Number(p.seat)===mySeat),needsColor=colorsForGame().length>0;
    const readyButton=$('#room-play-ready');readyButton.hidden=!lobby||!joined;readyButton.disabled=needsColor&&!me?.color;readyButton.textContent=me?.ready?'Not ready yet':'I am ready';
    const colorsBox=$('#room-play-color-box'),colorSelect=$('#room-play-color');colorsBox.hidden=!lobby||!joined||!needsColor;
    if(needsColor&&joined){fillColors(colorSelect,players,mySeat,me?.color||'');$('#room-play-color-save').disabled=!colorSelect.value||colorSelect.value===me?.color;}
    const canStart=!!host&&lobby;$('#room-play-start').hidden=!canStart;
    const filled=(players||[]).length===count,ready=(players||[]).length===count&&(players||[]).every(p=>p.ready),colored=!needsColor||(players||[]).length===count&&(players||[]).every(p=>!!p.color);
    $('#room-play-start').disabled=!filled||!ready||!colored;
    const inviteForm=$('#room-play-invite-form');inviteForm.hidden=!lobby||!joined;
    const assignForm=$('#room-play-assign-form');assignForm.hidden=!lobby||!host;
    if(!assignForm.hidden){
      const assignName=$('#room-play-assign-name'),priorName=assignName.value,activeNames=(roomMembers||[]).map(m=>m.name).filter(name=>name&&name!==getSession()?.profile?.name);
      assignName.replaceChildren(...activeNames.map(name=>{const opt=node('option','',name);opt.value=name;return opt;}));if(activeNames.includes(priorName))assignName.value=priorName;
      const assignSeat=$('#room-play-assign-seat'),priorSeat=assignSeat.value,occupied=new Set((players||[]).map(p=>Number(p.seat)));
      assignSeat.replaceChildren(...Array.from({length:Math.max(0,count-1)},(_,i)=>i+2).filter(seat=>!occupied.has(seat)).map(seat=>{const opt=node('option','',`Player ${seat}`);opt.value=String(seat);return opt;}));if([...assignSeat.options].some(o=>o.value===priorSeat))assignSeat.value=priorSeat;
      assignForm.hidden=!activeNames.length||!assignSeat.options.length;
    }
    commentsEnabled=typeof game.commentsEnabled==='boolean'?game.commentsEnabled:commentsEnabled;
    $('#room-play-comments-toggle-wrap').hidden=!canModerateComments;
    $('#room-play-comments-toggle').checked=commentsEnabled;
    $('#room-play-comment-form').hidden=!commentsEnabled;
    const readyN=(players||[]).filter(p=>p.ready).length;
    if(lobby)$('#room-play-status').textContent=`Waiting for players to join and ready up. ${readyN} of ${count} ready.${needsColor&&!colored?' Choose a unique color before starting.':''}`;
  }
  function renderEvents(events=[]){
    const hostList=$('#room-play-comments');
    for(const e of events){afterId=Math.max(afterId||0,Number(e.id)||0);
      if(e.kind==='comment'){
        const li=node('li',`room-play-comment${e.replyTo?' is-reply':''}`);const meta=node('strong','',e.replyTo?`${e.name} replied to ${e.replyName||'a comment'}: `:`${e.name}: `);li.append(meta,document.createTextNode(e.body||''));
        const reply=button('Reply',()=>{replyTo=Number(e.id);$('#room-play-comment-text').value=`@${e.name} `;$('#room-play-comment-text').focus();$('#room-play-replying').textContent=`Replying to ${e.name}.`;$('#room-play-reply-cancel').hidden=false;},'text-button');reply.disabled=!commentsEnabled;reply.setAttribute('aria-label',`Reply to ${e.name}'s comment`);li.append(reply);hostList.append(li);
      }
      if(firstPoll)continue;
      if(e.kind==='sfx'&&e.name!==getSession()?.profile?.name)playSfx(e.body);
      else if(e.kind==='say'&&e.name!==getSession()?.profile?.name)announce(e.body);
      else if(e.kind==='match'&&e.name!==getSession()?.profile?.name)playMatchSound(e.body);
    }
    while(hostList.children.length>100)hostList.firstElementChild.remove();
  }
  function render(d){
    game.phase=d.phase;game.state=d.state||{};game.maxPlayers=d.maxPlayers||game.maxPlayers||2;game.commentsEnabled=typeof d.commentsEnabled==='boolean'?d.commentsEnabled:game.commentsEnabled;commentsEnabled=typeof d.commentsEnabled==='boolean'?d.commentsEnabled:commentsEnabled;roomMembers=d.roomMembers||roomMembers;game.host=d.host||game.host;mySeat=Number(d.seat)||mySeat;host=typeof d.hostMe==='boolean'?d.hostMe:!!d.host;canModerateComments=host||(typeof d.creatorMe==='boolean'?d.creatorMe:!!game.creatorMe);joined=true;
    showPlayers(d.players||[],game.maxPlayers);renderEvents(d.events||[]);
    $('#room-play-join-form').hidden=true;
    $('#room-play-lobby').hidden=true;$('#room-play-quiz').hidden=true;$('#room-play-letters').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=true;
    if(d.phase==='lobby'){
      $('#room-play-lobby').hidden=false;
      $('#room-play-lobby-copy').textContent=`No questions or game board will be shown until ${game.host||'the host'} starts after every player slot is filled, colors are chosen where needed, and everyone is ready.`;
    }else if(d.phase==='playing'){
      if(game.kind==='quiz')renderQuiz(d);
      else if(game.kind==='letters')renderLetters(d);
      else if(game.kind==='soundmatch')renderSoundMatch(d);
      else renderBoard(d);
    }else if(d.phase==='finished'){
      if(game.kind==='quiz'){$('#room-play-quiz').hidden=false;$('#room-play-question').textContent='The quiz is complete.';$('#room-play-options').replaceChildren();}
      else if(game.kind==='letters')renderLetters(d);
      else if(game.kind==='soundmatch')renderSoundMatch(d);
      else renderBoard(d);
      say(`${game.title} has finished.`);
    }
    if(firstPoll){firstPoll=false;if(d.phase==='playing')say(`${game.title} has started. Good luck!`);}
  }
  async function poll(){clearTimeout(timer);if(!active()||!joined)return;
    try{const d=await callApi('game-watch',{gameId:game.id,afterId});if(!active())return;render(d);}
    catch(err){if(err.message==='game_unavailable'){say(errorText(err.message),true);return;}if(firstPoll)say(errorText(err.message),true);}
    if(active()&&joined)timer=setTimeout(poll,pollDelay());
  }
  function shuffleFor(index){return deterministicShuffle;}
  function sharedQuestion(q,index,state){const random=rngFor(`${game.id}:${index}:${game.config.mode||'classic'}`);return presentQuestion(q,game.config.mode||'classic',items=>deterministicShuffle(items,random),state?.yesNoCandidates?.[index]??null);}
  function renderQuiz(d){
    $('#room-play-quiz').hidden=false;$('#room-play-letters').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=true;
    const ids=d.state?.questionIds||[],index=Number(d.state?.currentIndex)||0;
    if(index>=ids.length){$('#room-play-question').textContent='The quiz is complete.';$('#room-play-options').replaceChildren();return;}
    const q=questionBank.find(item=>item.id===ids[index]);
    if(!q){$('#room-play-question').textContent=`Question ${index+1} is not on this version of Blind Quiz. Reload to update the app.`;$('#room-play-options').replaceChildren();return;}
    if(localQuestion!==index){localQuestion=index;questionLock=false;$('#room-play-options').replaceChildren();const shown=sharedQuestion(q,index,d.state);$('#room-play-question').textContent=`Question ${index+1} of ${ids.length}. ${shown.displayQuestion}`;$('#room-play-progress').textContent=`${index+1} of ${ids.length} · ${game.config.mode||'classic'}`;
      shown.displayAnswers.forEach((answer,i)=>{const b=button(`${String.fromCharCode(65+i)}. ${answer}`,()=>answerQuiz(index,answer,b),'answer-button');b.dataset.answer=answer;$('#room-play-options').append(b);});
    }
    const solved=!!d.state?.solvedAt;
    if(solved){$('#room-play-options').querySelectorAll('button').forEach(b=>b.disabled=true);$('#room-play-status').textContent='Correct answer found. Next question starts in a moment.';}
    else if(game.config.mode==='quickdecision'&&d.state?.questionStartedAt){const left=Math.max(0,5-Math.floor((Date.now()-Date.parse(d.state.questionStartedAt))/1000));$('#room-play-status').textContent=`Quick Decision: ${left} second${left===1?'':'s'} left. First correct answer earns the bonus.`;}
    else $('#room-play-status').textContent='Both players see the same question. The first correct answer earns the fastest-answer bonus.';
  }
  async function answerQuiz(index,answer,selected){if(questionLock||!game)return;questionLock=true;$('#room-play-options').querySelectorAll('button').forEach(b=>b.disabled=true);playSfx('click');
    try{const d=await callApi('game-answer',{gameId:game.id,questionIndex:index,answer});const correct=!!d.correct;const points=Number(d.points)||0;const text=correct?`Correct! ${points?`You earned ${points} point${points===1?'':'s'}.`:''}`:'Not quite. The other player can still answer.';$('#room-play-answer-status').textContent=text;playSfx(correct?'correct':'wrong');if(d.finished)say('The quiz is complete.');}
    catch(err){questionLock=false;$('#room-play-options').querySelectorAll('button').forEach(b=>b.disabled=false);say(errorText(err.message),true);if(err.message==='stale_question')poll();}
    void selected;
  }
  function renderLetters(d){
    const state=d.state||{};$('#room-play-letters').hidden=false;$('#room-play-quiz').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=true;
    const letters=String(state.letters||'').toUpperCase();$('#room-play-letters-tiles').textContent=[...letters].join('  ·  ');
    const ends=Date.parse(state.endsAt||'');const seconds=Number.isFinite(ends)?Math.max(0,Math.ceil((ends-Date.now())/1000)):0;
    $('#room-play-letters-clock').textContent=d.phase==='finished'?'Round complete.':`Time remaining: ${seconds} seconds. Longer words score more points.`;
    const form=$('#room-play-word-form');form.hidden=d.phase!=='playing';
    const found=state.foundWords||[];$('#room-play-word-list').replaceChildren(...found.map(item=>node('li','',`${String(item.word||'').toUpperCase()} · Player ${item.seat} · ${item.points} points`)));
    if(d.phase==='finished')$('#room-play-word-status').textContent=state.winner?`Player ${state.winner} wins with the highest score.`:'The word round is complete.';
  }
  async function submitWord(e){e.preventDefault();if(!game||wordPending||game.phase!=='playing')return;const input=$('#room-play-word'),word=input.value.trim().toLowerCase();if(!word)return;wordPending=true;$('#room-play-word-status').textContent='Checking that word…';
    try{const result=await callApi('game-letter-word',{gameId:game.id,word});input.value='';if(!result.valid){playSfx('wrong');$('#room-play-word-status').textContent='That is not a dictionary word made from these letters. Try another.';}
      else if(result.alreadyFound){$('#room-play-word-status').textContent=`${word.toUpperCase()} has already been found.`;}
      else{playSfx('correct');$('#room-play-word-status').textContent=`${word.toUpperCase()} is valid! ${result.points} points.`;poll();}}
    catch(err){$('#room-play-word-status').textContent=errorText(err.message);if(err.message==='game_finished')poll();}
    finally{wordPending=false;}
  }
  function renderSoundMatch(d){
    const state=d.state||{},count=Math.max(0,Number(state.cardCount)||0),matched=new Set(state.matched||[]),visible=new Set(state.visiblePair||[]),names=state.revealedNames||{};
    $('#room-play-sound').hidden=false;$('#room-play-quiz').hidden=true;$('#room-play-letters').hidden=true;$('#room-play-board-wrap').hidden=true;
    const grid=$('#room-play-sound-grid'),canFlip=d.phase==='playing'&&Number(state.turnSeat)===mySeat&&!state.resolveAt&&!state.finished;
    grid.replaceChildren(...Array.from({length:count},(_,i)=>{const number=i+1,isFound=matched.has(number),isOpen=visible.has(number),name=names[String(number)];const card=button(isFound?`Number ${number}: ${name||'pair found'}`:`Number ${number}${isOpen?': sound revealed':', hidden sound'}`,()=>flipSound(number),'room-play-sound-card');card.classList.toggle('is-open',isOpen);card.classList.toggle('is-matched',isFound);card.disabled=!canFlip||isFound||isOpen;card.setAttribute('aria-label',isFound?`Number ${number}, matched sound ${name||''}`:`Number ${number}${isOpen?', revealed':''}, ${isOpen?'play again':'flip'} sound card`);return card;}));
    const pairs=count/2,found=matched.size/2;let status=`Pairs found: ${found} of ${pairs} · Attempts: ${Number(state.tries)||0}. `;
    if(d.phase==='finished')status+=state.winner===0?'The game is a tie.':`Player ${state.winner} wins!`;
    else if(state.resolveAt){const left=Math.max(0,Math.ceil((Date.parse(state.resolveAt)-Date.now())/1000));status+=`${state.lastMatched?'Match!':'No match.'} Cards turn over in ${left} second${left===1?'':'s'}.`;}
    else status+=Number(state.turnSeat)===mySeat?'Your turn. Flip two numbered sounds.':`Player ${state.turnSeat}'s turn.`;
    $('#room-play-sound-status').textContent=status;
  }
  async function flipSound(number){if(!game||soundPending||game.phase!=='playing')return;soundPending=true;
    try{const result=await callApi('game-sound-flip',{gameId:game.id,number});if(result.slot)playMatchSound(result.slot);if(result.matched===true)playSfx('correct');else if(result.matched===false)playSfx('wrong');poll();}
    catch(err){say(errorText(err.message),true);if(['not_your_turn','invalid_action','game_finished'].includes(err.message))poll();}
    finally{soundPending=false;}
  }
  function makeQuestionPayload(){
    const category=game.config.category||'general',mode=game.config.mode||'classic';
    const selected=selectRoundQuestions(questionBank,category,mode);
    return {questionIds:selected.map(q=>q.id),answerKeys:selected.map(q=>q.correctAnswer),...(mode==='yesno'?{answerOptions:selected.map(q=>q.answers)}:{})};
  }
  async function startMatch(){if(!game||!host)return;const btn=$('#room-play-start');btn.disabled=true;
    try{
      let initial;
      if(game.kind==='quiz')initial=makeQuestionPayload();
      else if(game.kind==='letters')initial={kind:'letters'};
      else if(game.kind==='soundmatch'){
        const level=game.config.level||'easy',pairs=level==='hard'?10:level==='medium'?8:5,pool=await matchSounds();
        if(!Array.isArray(pool)||pool.length<pairs)throw new Error('sounds_unavailable');
        initial={kind:'soundmatch',soundSlots:deterministicShuffle(pool,rngFor(game.id)).slice(0,pairs).map(s=>({slot:s.slot,name:s.name}))};
      }else initial=game.kind==='blackjack'?{kind:'blackjack'}:createBoardState(game.kind,game.maxPlayers||2);
      await callApi('game-start',{gameId:game.id,initialState:initial});playSfx('go');poll();
    }catch(err){say(err.message==='sounds_unavailable'?'The recorded sounds could not be loaded. Please check your internet connection and try again.':errorText(err.message),true);}
    finally{btn.disabled=false;}
  }
  async function toggleReady(){if(!game||!joined)return;const me=(scoreCache||[]).find(p=>Number(p.seat)===mySeat);try{await callApi('game-ready',{gameId:game.id,ready:!me?.ready});playSfx('click');poll();}catch(err){say(errorText(err.message),true);}}
  async function invite(e){e.preventDefault();const name=$('#room-play-invite-name').value.trim();if(name.length<2)return say('Type your friend’s name first.',true);try{await callApi('game-invite',{gameId:game.id,name});$('#room-play-invite-name').value='';say(`${name} received a request to join the game.`);playSfx('notify');}catch(err){say(errorText(err.message),true);}}
  async function assignPlayer(e){e.preventDefault();const name=$('#room-play-assign-name').value,seat=Number($('#room-play-assign-seat').value);if(!name||!seat)return;try{await callApi('game-assign',{gameId:game.id,name,seat});say(`${name} assigned to Player ${seat}.`);poll();}catch(err){say(errorText(err.message),true);}}
  async function saveColor(){if(!game||!joined||!mySeat)return;const color=$('#room-play-color').value;if(!color)return say('Choose a color first.',true);try{await callApi('game-join',{gameId:game.id,seat:mySeat,color});say(`Player ${mySeat} chose ${color}.`);playSfx('click');poll();}catch(err){say(errorText(err.message),true);if(err.message==='color_taken')poll();}}
  async function setCommentsEnabled(){const checkbox=$('#room-play-comments-toggle'),next=checkbox.checked;checkbox.disabled=true;try{await callApi('game-comments',{gameId:game.id,enabled:next});commentsEnabled=next;game.commentsEnabled=next;$('#room-play-comment-form').hidden=!next;say(next?'Game comments are on.':'Game comments are off.');}catch(err){checkbox.checked=commentsEnabled;say(errorText(err.message),true);}finally{checkbox.disabled=false;}}
  async function sendComment(e){e.preventDefault();const text=$('#room-play-comment-text').value.trim();if(!text||!game)return;if(!commentsEnabled)return say(errorText('comments_disabled'),true);try{await callApi('game-comment',{roomId:game.roomId,gameId:game.id,text,replyTo});$('#room-play-comment-text').value='';replyTo=null;$('#room-play-replying').textContent='';$('#room-play-reply-cancel').hidden=true;poll();}catch(err){say(errorText(err.message),true);}}
  function cancelReply(){replyTo=null;$('#room-play-comment-text').value='';$('#room-play-replying').textContent='';$('#room-play-reply-cancel').hidden=true;}
  async function sendBoardAction(action){
    if(!game?.state||!mySeat||boardPending)return;boardPending=true;
    try{
      const result=await callApi('game-action',{gameId:game.id,move:action});
      for(const sound of result.sounds||[result.sfx||'click'])playSfx(sound);if(result.finished)playSfx('cheer');poll();
    }catch(err){say(errorText(err.message),true);if(['not_your_turn','illegal_chess_move','illegal_token_move','choose_token_first','stale_action'].includes(err.message))poll();}
    finally{boardPending=false;}
  }
  function renderBoard(d){
    $('#room-play-quiz').hidden=true;$('#room-play-letters').hidden=true;$('#room-play-sound').hidden=true;$('#room-play-board-wrap').hidden=false;
    const state=d.state||{},board=$('#room-play-board'),controls=$('#room-play-controls');board.replaceChildren();controls.replaceChildren();
    if(game.kind==='snakes')renderSnakes(state,board,controls);
    else if(game.kind==='ludo')renderLudo(state,board,controls);
    else if(game.kind==='carrom')renderCarrom(state,board,controls);
    else if(game.kind==='blackjack')renderBlackjack(state,board,controls);
    else if(game.kind==='chess')renderChess(state,board,controls);
  }
  function renderSnakes(state,board,controls){
    const grid=node('div','snakes-grid');
    for(let row=9;row>=0;row--){for(let col=0;col<10;col++){
      const offset=9-row,start=offset*10+1,num=offset%2===0?start+col:start+9-col;
      const cell=node('div',`snake-cell${Object.hasOwn(SNAKES_AND_LADDERS,num)?' has-jump':''}`);cell.setAttribute('aria-label',`Square ${num}${SNAKES_AND_LADDERS[num]?`, moves to ${SNAKES_AND_LADDERS[num]}`:''}`);
      cell.append(node('span','snake-number',String(num)));
      if(SNAKES_AND_LADDERS[num])cell.append(node('small','snake-jump',`${SNAKES_AND_LADDERS[num]>num?'↑':'↓'} ${SNAKES_AND_LADDERS[num]}`));
      const tokens=(state.players||[]).filter(p=>p.position===num).map(p=>node('span',`game-token seat-${p.seat}`,`P${p.seat}`));if(tokens.length)cell.append(...tokens);
      grid.append(cell);
    }}
    board.append(grid,node('p','muted',`Your token: Player ${mySeat} · Start at 0; reach exactly 100 to win.`));
    if(state.winner)board.append(node('p','game-result',`Player ${state.winner} wins!`));
    const roll=button('Roll the dice',()=>sendBoardAction({type:'roll'}),'button button-hot');roll.disabled=!!state.finished||!!state.winner;controls.append(roll);
  }
  function renderLudo(state,board,controls){
    const track=node('div','ludo-track');
    for(const player of state.players||[]){const card=node('section',`ludo-player seat-${player.seat} color-${player.color||'default'}`);card.append(node('h3','',`Player ${player.seat}${Number(player.seat)===mySeat?' · You':''}${player.color?` · ${player.color}`:''}`));
      const tokens=node('div','ludo-tokens');player.tokens.forEach((position,index)=>{const label=position<0?'Home':position===57?'Finish':`Step ${position+1}`;const b=button(`Token ${index+1}: ${label}`,()=>sendBoardAction({type:'move',token:index}),'ludo-token');b.disabled=!!state.finished||!!state.winner||Number(player.seat)!==mySeat||Number(state.turnSeat)!==mySeat||!state.pendingRoll||!legalLudoForUi(position,state.pendingRoll);tokens.append(b);});
      card.append(tokens);track.append(card);
    }
    board.append(track,node('p','muted',state.pendingRoll?`You rolled ${state.pendingRoll}. Choose a highlighted token.`:'A six brings a token out. Finish with an exact roll.'));
    if(state.winner)board.append(node('p','game-result',`Player ${state.winner} wins!`));
    if(Number(state.turnSeat)===mySeat&&!state.pendingRoll){const roll=button('Roll the dice',()=>sendBoardAction({type:'roll'}),'button button-hot');roll.disabled=!!state.finished||!!state.winner;controls.append(roll);}
  }
  function legalLudoForUi(position,roll){return position<57&&(position<0?roll===6:position+roll<=57);}
  function renderCarrom(state,board,controls){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('role','img');svg.setAttribute('aria-label','Carrom board with coins and four corner pockets');
    const rect=document.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('x','4');rect.setAttribute('y','4');rect.setAttribute('width','92');rect.setAttribute('height','92');rect.setAttribute('rx','7');rect.setAttribute('class','carrom-wood');svg.append(rect);
    for(const [x,y] of [[8,8],[92,8],[8,92],[92,92]]){const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(x));c.setAttribute('cy',String(y));c.setAttribute('r','5');c.setAttribute('class','carrom-pocket');svg.append(c);}
    for(const coin of state.coins||[]){if(coin.pocketed)continue;const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(coin.x*100));c.setAttribute('cy',String(coin.y*100));c.setAttribute('r','2.2');c.setAttribute('class',`carrom-coin seat-${coin.owner}`);svg.append(c);}
    const s=state.striker||{x:.5,y:.88},striker=document.createElementNS(svg.namespaceURI,'circle');striker.setAttribute('cx',String(s.x*100));striker.setAttribute('cy',String(s.y*100));striker.setAttribute('r','3.2');striker.setAttribute('class','carrom-striker');svg.append(striker);board.append(svg);
    const mine=(state.players||[]).find(p=>Number(p.seat)===mySeat);board.append(node('p','muted',`Your score: ${mine?.score||0} · Opponent: ${(state.players||[]).find(p=>Number(p.seat)!==mySeat)?.score||0}`));
    if(state.finished)board.append(node('p','game-result',state.winner===0?'Carrom ends in a draw.':state.winner?`Player ${state.winner} wins!`:'Carrom is complete.'));
    const aim=node('label','',`Aim angle: ${$('#carrom-aim')?.value||'0'}°`),aimInput=node('input','');aimInput.id='carrom-aim';aimInput.type='range';aimInput.min='0';aimInput.max='359';aimInput.value='0';aimInput.disabled=!!state.finished||Number(state.turnSeat)!==mySeat;aimInput.addEventListener('input',()=>aim.firstChild.textContent=`Aim angle: ${aimInput.value}°`);aim.append(aimInput);
    const power=node('label','',`Shot power: ${$('#carrom-power')?.value||'65'}%`),powerInput=node('input','');powerInput.id='carrom-power';powerInput.type='range';powerInput.min='30';powerInput.max='100';powerInput.value='65';powerInput.disabled=!!state.finished||Number(state.turnSeat)!==mySeat;powerInput.addEventListener('input',()=>power.firstChild.textContent=`Shot power: ${powerInput.value}%`);power.append(powerInput);controls.append(aim,power);
    controls.append(button('Strike',()=>sendBoardAction({type:'strike',aim:Number(aimInput.value),power:Number(powerInput.value)/100}),'button button-hot'));
    if(state.finished||Number(state.turnSeat)!==mySeat)controls.lastElementChild.disabled=true;
  }
  const cardValue=card=>{const rank=String(card||'').slice(0,-1);return rank==='hidden'?'?':rank;};
  const handValue=hand=>{let n=0,aces=0;for(const c of hand||[]){const r=String(c).slice(0,-1);if(r==='A'){n+=11;aces++;}else n+=['K','Q','J'].includes(r)?10:Number(r)||0;}while(n>21&&aces){n-=10;aces--;}return n;};
  function handText(hand){return (hand||[]).map(card=>card==='hidden'?'🂠':card).join('  ')||'No cards';}
  function renderBlackjack(state,board,controls){
    const dealer=node('section','blackjack-hand');dealer.append(node('h3','','Dealer'),node('p','',`${handText(state.dealer)}${state.finished?` · ${handValue(state.dealer)}`:''}`));board.append(dealer);
    for(const p of state.players||[]){const section=node('section',`blackjack-hand${p.seat===mySeat?' is-you':''}`);section.append(node('h3','',`Player ${p.seat}${p.seat===mySeat?' · You':''}`),node('p','',`${handText(p.hand)} · ${handValue(p.hand)}${p.bust?' · Bust':''}${p.stood?' · Stood':''}`));board.append(section);}
    if(!state.finished&&Number(state.turnSeat)===mySeat){controls.append(button('Hit',()=>sendBoardAction({type:'hit'}),'button button-hot'),button('Stand',()=>sendBoardAction({type:'stand'}),'button button-outline'));}
    else if(!state.finished)board.append(node('p','muted',`Player ${state.turnSeat} is deciding.`));
    else board.append(node('p','game-result',state.winner===mySeat?'You win!':state.winner===0?'Push — it is a tie.':'Round over. Check the scores above.'));
  }
  function renderChess(state,board,controls){
    if(state.finished||state.winner)boardSelected=null;
    const grid=node('div','chess-board');const legal=boardSelected?legalChessMoves(state,boardSelected):[];
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const piece=state.board?.[r]?.[c]||'',btn=button(PIECES[piece]||' ',()=>clickChess(state,r,c),'chess-square');
      btn.classList.add((r+c)%2?'dark-square':'light-square');if(boardSelected?.[0]===r&&boardSelected?.[1]===c)btn.classList.add('selected-square');if(legal.some(m=>m.to[0]===r&&m.to[1]===c))btn.classList.add('legal-square');
      btn.setAttribute('aria-label',`${String.fromCharCode(97+c)}${8-r}${piece?`, ${pieceWhite(piece)?'White':'Black'} ${pieceName(piece)}`:', empty'}${legal.some(m=>m.to[0]===r&&m.to[1]===c)?', legal destination':''}`);btn.dataset.row=String(r);btn.dataset.col=String(c);btn.disabled=!!state.finished;grid.append(btn);
    }
    const whiteSeat=Number(state.colorSeats?.white??1),status=state.finished?(state.winner===0?'Stalemate. The game is a draw.':`Player ${state.winner} wins.`):`${Number(state.turnSeat)===whiteSeat?'White':'Black'} to move${Number(state.turnSeat)===mySeat?' · Your turn':''}. Tap a piece, then a highlighted square.`;
    board.append(grid,node('p',state.finished?'game-result':'muted',status));
  }
  function pieceName(piece){return({k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'})[piece.toLowerCase()]||'piece';}
  function clickChess(state,r,c){
    if(state.finished||state.winner)return;
    const piece=state.board[r][c];
    if(boardSelected){const moves=legalChessMoves(state,boardSelected);if(moves.some(m=>m.to[0]===r&&m.to[1]===c)){const from=boardSelected;boardSelected=null;sendBoardAction({type:'move',from,to:[r,c]});return;}}
    if(piece&&pieceWhite(piece)===(Number(state.colorSeats?.white??1)===mySeat)&&Number(state.turnSeat)===mySeat){boardSelected=[r,c];renderBoard({state});}else{boardSelected=null;renderBoard({state});}
  }

  $('#room-play-join-form')?.addEventListener('submit',joinSelected);
  $('#room-play-ready')?.addEventListener('click',toggleReady);
  $('#room-play-start')?.addEventListener('click',startMatch);
  $('#room-play-color-save')?.addEventListener('click',saveColor);
  $('#room-play-assign-form')?.addEventListener('submit',assignPlayer);
  $('#room-play-comments-toggle')?.addEventListener('change',setCommentsEnabled);
  $('#room-play-invite-form')?.addEventListener('submit',invite);
  $('#room-play-word-form')?.addEventListener('submit',submitWord);
  $('#room-play-comment-form')?.addEventListener('submit',sendComment);
  $('#room-play-reply-cancel')?.addEventListener('click',cancelReply);
  $('#room-play-back')?.addEventListener('click',()=>go('room',{after:refreshRoom}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active())poll();});
  return {open,close(){clearTimeout(timer);timer=null;},get score(){return scoreCache.find(p=>Number(p.seat)===mySeat)?.score||0;}};
}
