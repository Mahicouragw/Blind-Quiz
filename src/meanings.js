// Short word meanings for Letters to Words, from Princeton WordNet 3.1 (see assets/meanings/LICENSE.txt).
// Files are split by first letter and fetched only when needed (and then cached by the service worker),
// so meanings also work offline and nothing about the player is sent anywhere.
const files = new Map();
function load(letter) {
  if (!/^[a-z]$/.test(letter)) return Promise.resolve({});
  if (!files.has(letter)) {
    files.set(letter, fetch(`./assets/meanings/${letter}.json`).then(r => (r.ok ? r.json() : {})).catch(() => { files.delete(letter); return {}; }));
  }
  return files.get(letter);
}

/** Starts loading the meaning files for a puzzle's letters, so meanings are ready when words are found. */
export function preloadMeanings(letters) { for (const l of new Set(letters)) load(String(l).toLowerCase()); }

/** Resolves to { meaning, base } or null; never waits longer than `ms`. */
export async function meaningOf(word, ms = 1500) {
  const w = String(word).toLowerCase();
  let timer;
  const data = await Promise.race([load(w[0]), new Promise(r => { timer = setTimeout(() => r(null), ms); })]);
  clearTimeout(timer);
  const entry = data && Object.prototype.hasOwnProperty.call(data, w) ? data[w] : null;
  if (!entry) return null;
  return Array.isArray(entry) ? { meaning: entry[0], base: entry[1] } : { meaning: entry, base: null };
}

const end = text => (/[.…!?]$/.test(text) ? text : `${text}.`);
/** " Meaning: to perceive by sight." or " Meaning (from SEE): to perceive by sight." */
export const meaningLine = m => (!m ? '' : ` Meaning${m.base ? ` (from ${m.base.toUpperCase()})` : ''}: ${end(m.meaning)}`);
