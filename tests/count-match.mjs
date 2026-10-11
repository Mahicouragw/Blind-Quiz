import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COUNT_MATCH_ITEMS, COUNT_MATCH_ROUNDS, advanceCountMatch, answerCountMatch,
  buildCountRounds, countMatchAccuracy, countMatchUrl, createCountMatch,
} from '../src/count-match.js';

let seed = 173;
const random = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;

assert.deepEqual(COUNT_MATCH_ROUNDS, [10, 20, 30, 50, 70], 'round-count selector supports quick through marathon games');
assert.equal(COUNT_MATCH_ITEMS.length, 35, 'seven fruits each have one-through-five count pairs');
for (const phrase of ['1 Apple', '3 Apples', '2 Bananas', '4 Bananas', '5 Bananas']) {
  assert(COUNT_MATCH_ITEMS.some(item => item.label === phrase), `${phrase} is in the audio-visual pair bank`);
}
assert.equal(COUNT_MATCH_ITEMS.find(item => item.id === 'apple-1').spoken, 'one apple', 'singular clue is spoken correctly');
assert.equal(COUNT_MATCH_ITEMS.find(item => item.id === 'apple-3').spoken, 'three apples', 'plural clue is spoken correctly');
assert.equal(new Set(COUNT_MATCH_ITEMS.map(item => item.id)).size, COUNT_MATCH_ITEMS.length, 'fruit/count pair IDs are unique');

for (const rounds of COUNT_MATCH_ROUNDS) {
  const game = buildCountRounds(rounds, random);
  assert.equal(game.length, rounds, `${rounds}-round game builds the selected number of rounds`);
  for (let index = 0; index < game.length; index++) {
    const round = game[index];
    assert.equal(round.options.length, 4, 'each spoken clue has four picture choices');
    assert.equal(new Set(round.options.map(item => item.id)).size, 4, 'picture choices are distinct');
    assert(round.options.some(item => item.id === round.target.id), 'the correct audio-visual pair is among the choices');
    if (index) assert.notEqual(round.target.id, game[index - 1].target.id, 'consecutive clues do not repeat');
  }
}
assert.throws(() => buildCountRounds(11, random), /invalid_round_count/, 'only offered round counts are accepted');

const game = createCountMatch(10, random);
assert.equal(advanceCountMatch(game).type, 'ignored', 'round cannot advance before an answer');
let result = answerCountMatch(game, game.rounds[0].target.id);
assert.equal(result.type, 'correct');
assert.equal(result.points, 100);
assert.equal(game.score, 100);
assert.equal(answerCountMatch(game, game.rounds[0].target.id).type, 'ignored', 'one answer is accepted per round');
assert.equal(advanceCountMatch(game).type, 'next');
result = answerCountMatch(game, game.rounds[1].options.find(item => item.id !== game.rounds[1].target.id).id);
assert.equal(result.type, 'miss');
assert.equal(game.streak, 0, 'incorrect answers reset the streak');
assert.equal(game.score, 100, 'incorrect answers do not add points');
assert.equal(countMatchAccuracy(7, 10), 70);
assert.equal(countMatchAccuracy(0, 0), 0);

const perfect = createCountMatch(10, random);
for (let round = 0; round < 10; round++) {
  const answer = answerCountMatch(perfect, perfect.rounds[round].target.id);
  assert.equal(answer.type, 'correct');
  const next = advanceCountMatch(perfect);
  assert.equal(next.type, round === 9 ? 'done' : 'next');
}
assert.equal(perfect.done, true);
assert.equal(perfect.correct, 10);
assert.equal(perfect.answered, 10);
assert.equal(perfect.bestStreak, 10);
assert.equal(perfect.score, 1750, 'correct streaks award bounded bonus points');
assert.equal(answerCountMatch(perfect, perfect.rounds.at(-1).target.id).type, 'ignored', 'completed game cannot accept more answers');

const shared = new URL(countMatchUrl('https://game.example/Blind-Quiz/?campaign=friend#old-route'));
assert.equal(shared.searchParams.get('campaign'), 'friend', 'share URLs preserve existing query parameters');
assert.equal(shared.searchParams.get('game'), 'count-match', 'share URL opens Count Match directly');
assert.equal(shared.hash, '', 'share URL does not preserve an unrelated in-page route');

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/count-match-ui.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert(html.includes('id="cm-open"') && html.includes('id="view-countmatch"'), 'home has a routed Count Match entry');
assert(html.includes('id="cm-round-count"') && ['10', '20', '30', '50', '70'].every(value => html.includes(`<option value="${value}"`)), 'screen exposes all five round lengths');
assert(html.includes('id="cm-scorecard"') && ['cm-final-score', 'cm-final-time', 'cm-final-accuracy'].every(id => html.includes(`id="${id}"`)), 'completion screen contains score, time, and accuracy');
assert(['whatsapp', 'facebook', 'x', 'instagram', 'copy'].every(service => html.includes(`data-cm-share="${service}"`)), 'scorecard offers WhatsApp, Facebook, X, Instagram, and copy');
assert(['wa.me', 'facebook.com/sharer', 'twitter.com/intent/tweet', 'nav?.share', 'countMatchUrl'].every(text => ui.includes(text)), 'share flows include platform links, a native share sheet, and the direct game URL');
assert(main.includes("get('game')==='count-match'") && main.includes("$('#cm-open').addEventListener('click',openCountMatch)"), 'direct challenge URLs and the home entry route to the game');
console.log('ok Count Match: round generation, fruit/count clues, scoring, accuracy, completion, share URLs, and UI integration');
