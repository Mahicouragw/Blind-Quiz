// Builds assets/meanings/<letter>.json: one short meaning for every Letters to Words answer word.
// Source: Princeton WordNet 3.1 (WordNet License, free to use and redistribute with the notice in
// assets/meanings/LICENSE.txt), read from the `wordnet-db` npm package. The game ships the generated
// files, so meanings work offline and no player data goes to any dictionary service.
//
//   npm i --no-save --no-package-lock wordnet-db@3.1.14 && node scripts/build-meanings.mjs
//
// For each word the most frequently used sense (WordNet tag counts) is chosen; inflected forms
// such as SEES, BAKED or TALLER use the meaning of their base word.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { WORD_TIERS } from '../src/words.js';
import { SHORT_WORD_TIERS } from '../src/short-words.js';

const require = createRequire(import.meta.url);
const DICT = process.env.WORDNET_DIR || join(dirname(require.resolve('wordnet-db/package.json')), 'dict');
const POS = [['noun', 'n'], ['verb', 'v'], ['adj', 'a'], ['adv', 'r']];
const index = new Map(); // lemma -> [{ pos, tagged, offset }]
const data = {};
for (const [file] of POS) {
  data[file] = new Map();
  for (const line of readFileSync(join(DICT, `data.${file}`), 'latin1').split('\n')) if (/^\d{8} /.test(line)) data[file].set(line.slice(0, 8), line);
  for (const line of readFileSync(join(DICT, `index.${file}`), 'latin1').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0];
    if (!/^[a-z]+$/.test(lemma)) continue;
    const pCnt = Number(f[3]);
    const tagged = Number(f[5 + pCnt]);
    const offsets = f.slice(6 + pCnt).filter(x => /^\d{8}$/.test(x));
    if (!index.has(lemma)) index.set(lemma, []);
    index.get(lemma).push({ pos: file, tagged, offsets });
  }
}

// Only senses where the word is written in lower case (so not ME = Maine, ATE = a goddess, AN = a degree).
function gloss(pos, offset, lemma) {
  const line = data[pos].get(offset);
  if (!line) return '';
  const f = line.split(' '), count = parseInt(f[3], 16);
  const forms = Array.from({ length: count }, (_, i) => f[4 + i * 2].replace(/\(.*\)$/, ''));
  if (!forms.includes(lemma)) return '';
  let g = line.slice(line.indexOf('| ') + 2).trim();
  g = g.split(/;\s*"|\s"/)[0].replace(/[;:,\s]+$/, '');
  g = g.split('; ')[0];                    // first definition only, examples dropped
  g = g.replace(/`/g, "'").replace(/^\([^)]*\)\s*/, '').replace(/\s*\([^()]*\)/g, '').replace(/:\s[^:]*$/, '').replace(/\s+/g, ' ').trim();
  if (g.length > 120) g = g.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  return g;
}

// Animals, plants and food are what players usually mean (TIGER the cat, not "a fierce person").
const CONCRETE = new Set(['05', '13', '20']);
const lexOf = (pos, offset) => (data[pos].get(offset) || '').split(' ')[1];
function senseOf(lemma, onlyPos) {
  const senses = (index.get(lemma) || []).filter(x => !onlyPos || x.pos === onlyPos);
  const order = { noun: 0, verb: 1, adj: 2, adv: 3 };
  for (const sense of [...senses].sort((a, b) => b.tagged - a.tagged || order[a.pos] - order[b.pos])) {
    let offsets = sense.offsets;
    if (sense.pos === 'noun' && lexOf('noun', offsets[0]) === '18') {
      const concrete = offsets.slice(1, 4).find(o => CONCRETE.has(lexOf('noun', o)));
      if (concrete) offsets = [concrete, ...offsets.filter(o => o !== concrete)];
    }
    for (const offset of offsets) {
      let g = gloss(sense.pos, offset, lemma);
      if (!g) continue;
      if (sense.pos === 'verb' && !/^to /.test(g)) g = `to ${g}`;
      return { g, pos: sense.pos, lex: lexOf(sense.pos, offset), tagged: senses.reduce((n, x) => n + x.tagged, 0) };
    }
  }
  return null;
}
const meaningOf = (lemma, onlyPos) => senseOf(lemma, onlyPos)?.g || null;
// SEATED, HEMMED, VOICING come from the verb.
const baseSense = (w, b) => (/(ed|ing)$/.test(w) && senseOf(b, 'verb')) || senseOf(b);

// Short everyday words that WordNet leaves out or only lists as abbreviations.
const OWN = {
  a: 'one; used before a word for a thing', an: 'one; used instead of A before a vowel sound', the: 'used before a word to mean a particular one',
  and: 'joins words or ideas together', or: 'joins choices, as in tea or coffee', but: 'used to show a contrast; except', nor: 'and not',
  if: 'on the condition that', of: 'belonging to, or made from', to: 'towards a place, person or thing', in: 'inside something', on: 'resting on the top of something',
  at: 'used to say where or when something happens', by: 'next to; or done by someone', for: 'meant to be given to or used by', as: 'in the same way as; while',
  via: 'by way of; through', per: 'for each', yet: 'until now; still', so: 'very; or for that reason', too: 'also; or more than enough', up: 'towards a higher place',
  is: 'a form of BE: he is, she is, it is', am: 'a form of BE used with I: I am', are: 'a form of BE: you are, we are, they are', be: 'to exist, or to have a quality',
  was: 'past form of BE: I was, it was', were: 'past form of BE: you were, they were', been: 'a form of BE: I have been',
  it: 'the thing being talked about', its: 'belonging to it', me: 'the person speaking: give it to me', my: 'belonging to me', we: 'the person speaking and others',
  us: 'the person speaking and others: come with us', our: 'belonging to us', you: 'the person or people being spoken to', your: 'belonging to you',
  he: 'a boy or man already talked about', him: 'a boy or man already talked about: I saw him', his: 'belonging to him', she: 'a girl or woman already talked about',
  her: 'a girl or woman already talked about; or belonging to her', they: 'the people or things being talked about', them: 'those people or things: I see them', their: 'belonging to them',
  who: 'which person', why: 'for what reason', how: 'in what way', what: 'which thing', when: 'at what time', where: 'in what place', this: 'the thing here', that: 'the thing there',
  no: 'not any; the opposite of yes', not: 'used to say the opposite', yes: 'used to agree or say that something is true', oh: 'a sound of surprise or understanding',
  ah: 'a sound of relief, pleasure or understanding', ha: 'a sound of laughter or surprise', hi: 'a friendly way to say hello', ma: 'mother', pa: 'father',
  ad: 'an advertisement', ox: 'a big, strong farm animal of the cattle family', do: 'to carry out an action', go: 'to move from one place to another',
  can: 'to be able to; or a metal container', may: 'to be allowed to; or might', did: 'past form of DO', has: 'a form of HAVE: she has', had: 'past form of HAVE',
  got: 'past form of GET', all: 'every one; the whole amount', any: 'one or some, it does not matter which', one: 'the number 1', two: 'the number 2', six: 'the number 6', ten: 'the number 10',
  own: 'belonging to yourself; or to have something', now: 'at this moment', off: 'away from; or not switched on', out: 'away from the inside', ago: 'before now',
  bear: 'a large, heavy animal with thick fur; or to carry or put up with', rose: 'a flower with a sweet smell and thorny stems; or past form of RISE',
  saw: 'past form of SEE; or a tool with a toothed blade for cutting', left: 'the side opposite right; or past form of LEAVE', ring: 'a circle, like a band worn on a finger; or to make a bell sound',
  clever: 'quick to learn and understand', fly: 'to travel through the air; or a small flying insect', bat: 'a flying mammal that is active at night; or a club for hitting a ball',
  new: 'not existing before; recently made', old: 'having lived or existed for a long time', guy: 'a man', kid: 'a child', boy: 'a male child', man: 'an adult male person', men: 'more than one man',
};
// Irregular verb forms -> base verb (their meaning is the base verb's meaning).
const IRREGULAR = Object.fromEntries(('ran:run ate:eat saw:see went:go gone:go came:come took:take made:make gave:give sat:sit met:meet led:lead fed:feed hid:hide won:win ' +
  'wore:wear tore:tear bore:bear rode:ride rose:rise drove:drive wrote:write spoke:speak broke:break chose:choose froze:freeze stole:steal woke:wake sang:sing sank:sink ' +
  'swam:swim drank:drink rang:ring began:begin knew:know grew:grow threw:throw flew:fly drew:draw blew:blow held:hold told:tell sold:sell felt:feel kept:keep slept:sleep ' +
  'wept:weep swept:sweep left:leave lent:lend sent:send spent:spend bent:bend built:build dealt:deal meant:mean lost:lose paid:pay laid:lay fought:fight bought:buy ' +
  'brought:bring caught:catch taught:teach thought:think sought:seek stood:stand found:find said:say done:do does:do lay:lie dug:dig hung:hang shook:shake shot:shoot ' +
  'slid:slide spun:spin stuck:stick struck:strike swung:swing taken:take eaten:eat given:give driven:drive written:write spoken:speak broken:break chosen:choose frozen:freeze ' +
  'stolen:steal woken:wake known:know grown:grow thrown:throw flown:fly drawn:draw risen:rise ridden:ride hidden:hide bitten:bite fallen:fall fell:fall forgot:forget ' +
  'forgotten:forget heard:hear lit:light sung:sing sunk:sink swum:swim drunk:drink rung:ring begun:begin wound:wind ground:grind bound:bind fled:flee shone:shine').split(' ').map(p => p.split(':')));

const doubled = w => w.length > 2 && w.at(-1) === w.at(-2) ? w.slice(0, -1) : null;
function baseForms(w) {
  const out = [];
  const add = x => { if (x && x.length >= 2 && x !== w) out.push(x); };
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ves')) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe'); }
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) { const s = w.slice(0, -2); add(s); add(s + 'e'); add(doubled(s)); }
  if (w.endsWith('ing')) { const s = w.slice(0, -3); add(s); add(s + 'e'); add(doubled(s)); }
  if (w.endsWith('ier')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('iest')) add(w.slice(0, -4) + 'y');
  if (w.endsWith('er')) { const s = w.slice(0, -2); add(s); add(s + 'e'); add(doubled(s)); }
  if (w.endsWith('est')) { const s = w.slice(0, -3); add(s); add(s + 'e'); add(doubled(s)); }
  if (w.endsWith('ly')) add(w.slice(0, -2));
  return out;
}

const words = [...new Set([...SHORT_WORD_TIERS, ...WORD_TIERS].flatMap(t => t.split(' ')).filter(Boolean))].sort();
const byLetter = {};
let direct = 0, viaBase = 0, missing = 0;
for (const w of words) {
  let m = OWN[w] || null, base = null;
  if (!m && IRREGULAR[w]) { base = IRREGULAR[w]; m = meaningOf(base, 'verb'); }
  if (!m) {
    base = null;
    const own = senseOf(w);
    m = own?.g || null;
    // RUNNING, FLIES: a much more common base word gives the meaning players expect.
    // Only when the word's own entry is rare, or is just "the act of" the verb (RUNNING as a football play).
    if (own && /(s|ed|ing)$/.test(w)) {
      for (const b of baseForms(w)) {
        const bs = baseSense(w, b);
        if (!bs) continue;
        if ((own.tagged <= 2 && bs.tagged > 5) || (/ing$/.test(w) && own.pos === 'noun' && own.lex === '04' && bs.pos === 'verb')) { m = bs.g; base = b; }
        break;
      }
    }
  }
  if (m) direct++;
  else {
    for (const b of baseForms(w)) { m = baseSense(w, b)?.g || null; if (m) { base = b; break; } }
    if (m) viaBase++; else { missing++; continue; }
  }
  (byLetter[w[0]] ||= {})[w] = base ? [m, base] : m;
}
const outDir = new URL('../assets/meanings/', import.meta.url);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [letter, map] of Object.entries(byLetter)) writeFileSync(new URL(`${letter}.json`, outDir), JSON.stringify(map));
writeFileSync(new URL('LICENSE.txt', outDir), `Word meanings in this folder are derived from Princeton WordNet 3.1.

WordNet Release 3.1. This software and database is being provided to you, the LICENSEE, by Princeton
University under the following license. By obtaining, using and/or copying this software and database,
you agree that you have read, understood, and will comply with these terms and conditions.:

Permission to use, copy, modify and distribute this software and database and its documentation for any
purpose and without fee or royalty is hereby granted, provided that you agree to comply with the
following copyright notice and statements, including the disclaimer, and that the same appear on ALL
copies of the software, database and documentation, including modifications that you make for internal
use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR
WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO
REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS,
COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to
distribution of the software and/or database. Title to copyright in this software, database and any
associated documentation shall at all times remain with Princeton University and LICENSEE agrees to
preserve same.
`);
console.log(`Meanings: ${words.length} words, ${direct} direct, ${viaBase} via base form, ${missing} without a meaning.`);
