// Home music playlist: each visit starts on the next track, a finished track hands over to the next one,
// and retrying the same playlist never skips a track. Runs in plain Node with a fake Audio element.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8'));
const played = [], elements = new Map();
class FakeAudio { constructor(src) { this.src = src; elements.set(src.split('/').pop().split('?')[0].replace('.mp3', ''), this); this.paused = true; this.volume = 1; this.currentTime = 0; this.onended = null; }
  play() { this.paused = false; played.push(this.src.split('/').pop().split('?')[0].replace('.mp3', '')); return Promise.resolve(); }
  pause() { this.paused = true; } addEventListener() {} }
globalThis.Audio = FakeAudio;
globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
const realSetInterval = globalThis.setInterval; globalThis.setInterval = (f) => realSetInterval(f, 0);
const audio = await import('../src/audio.js');
const tick = () => new Promise(r => setTimeout(r, 60));
const menu = Object.keys(manifest.assets).filter(k => /^music_menu\d*$/.test(k)).sort((a, b) => (parseInt(a.slice(10), 10) || 1) - (parseInt(b.slice(10), 10) || 1));
assert(menu.length >= 2, 'several home tracks are encoded: ' + menu.join(','));
audio.unlockAudio();
await audio.playMusic('music_menu'); await tick();
await audio.playMusic('music_menu'); await tick();          // same screen again: keeps playing, no skip
assert.deepEqual(played, ['music_menu'], 'first visit plays the first track once');
await audio.playMusic('music_game1'); await tick();
await audio.playMusic('music_menu'); await tick();
assert.equal(played.at(-1), menu[1], 'next visit to home starts on the next track');
// The current track finishing hands over to the next one (wrapping round at the end).
for (let step = 2; step < menu.length + 2; step++) {
  elements.get(played.at(-1)).onended();
  await tick();
  assert.equal(played.at(-1), menu[step % menu.length], `track ${step} follows when the previous one ends`);
}
audio.stopMusic(); await tick();
console.log(`PASS: home playlist of ${menu.length} tracks rotates per visit and plays on when a track ends.`);
process.exit(0);
