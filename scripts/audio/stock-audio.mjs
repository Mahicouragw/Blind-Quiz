#!/usr/bin/env node
// Builds assets/audio/ from licensed stock recordings:
//  - Sound effects: Mixkit, pinned by asset id in scripts/audio/sources.json (Mixkit Sound Effects Free
//    License: commercial use including games, no attribution required). Downloaded as the full WAV.
//  - Music: Pixabay tracks (Pixabay Content License) that the owner downloaded by hand from pixabay.com
//    and uploaded to assets/audio/incoming/<slot>-<original pixabay file name>.mp3. Pixabay does not allow
//    automated downloads, so this script never fetches from Pixabay; it only encodes uploaded files and
//    then deletes the originals. Music slots without an upload keep their previous recording.
// Every file is trimmed, loudness-normalised and encoded to MP3 with ffmpeg; manifest.json and
// AUDIO_LICENSES.md are regenerated from what was actually encoded.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const GH = !!process.env.GITHUB_ACTIONS;
const UA = 'BlindQuizAudioBuilder/2.0 (https://github.com/Mahicouragw/Blind-Quiz)';
const root = new URL('../../', import.meta.url);
const outDir = new URL('assets/audio/', root);
const incomingDir = new URL('assets/audio/incoming/', root);
const config = JSON.parse(await readFile(new URL('scripts/audio/sources.json', root), 'utf8'));
const manifestUrl = new URL('manifest.json', outDir);
const previous = existsSync(manifestUrl) ? JSON.parse(await readFile(manifestUrl, 'utf8')) : { assets: {} };
const note = (title, msg) => console.log(GH ? `::notice title=${title}::${msg}` : `${title}: ${msg}`);
const decode = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
// OpenGameArt page metadata, read from the live page so the licence is re-checked on every build.
async function ogaPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  const html = await res.text();
  const title = decode((html.match(/<title>([^|<]+)/) || [])[1]);
  const licBlock = (html.match(/field-name-field-art-licenses[\s\S]*?(?=<div class="field field-name-(?!field-art-licenses))/) || [''])[0];
  const licences = [...new Set([...licBlock.matchAll(/class=['"]license-name['"][^>]*>([^<]+)/g)].map(m => decode(m[1])))];
  const authorBlock = (html.match(/field-name-author-submitter[\s\S]{0,800}/) || [''])[0];
  const author = decode((authorBlock.match(/href="\/users\/[^"]+"[^>]*>([^<]+)</) || [])[1]) || 'Unknown';
  const date = decode((html.match(/field-name-post-date[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
  const files = [...new Set([...html.matchAll(/https?:\/\/opengameart\.org\/sites\/default\/files\/(?!audio_preview|styles)[^"'\s]+?\.(?:ogg|mp3|wav|flac)/gi)].map(m => m[0]))];
  const attribution = decode((html.match(/field-name-field-copyright-notice[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
  return { title, licences, author, date, files, attribution };
}
const OGA_OK = l => /^CC0$/i.test(l);

if (process.argv[2] === '--list') {
  for (const url of config.ogaCandidates || []) {
    try { const p = await ogaPage(url); note('OGA candidate', `${url} | ${p.title} | by ${p.author} | ${p.date} | licences: ${p.licences.join(', ') || 'NONE FOUND'} | files: ${p.files.map(f => decodeURIComponent(f.split('/').pop())).join(' ; ').slice(0, 600)}`); }
    catch (e) { note('OGA candidate', `${url} | ERROR ${e.message}`); }
  }
  process.exit(0);
}

const tmp = '/tmp/bq-stock-audio';
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });

function encode(src, slot, kind, max, start) {
  const isMusic = kind === 'music';
  const filters = [];
  if (start) filters.push(`atrim=start=${start}`, 'asetpts=PTS-STARTPTS');
  else filters.push('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02');
  filters.push(`atrim=duration=${max}`, 'asetpts=PTS-STARTPTS');
  filters.push(isMusic ? 'loudnorm=I=-20:TP=-2:LRA=11' : 'loudnorm=I=-16:TP=-1.5:LRA=7');
  const fadeOut = isMusic ? 3 : Math.min(0.25, max / 4);
  filters.push(`afade=t=in:d=${isMusic ? 1.5 : 0.005}`, 'areverse', `afade=t=in:d=${fadeOut}`, 'areverse');
  const out = new URL(`${slot}.mp3`, outDir).pathname;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', filters.join(','), '-map_metadata', '-1', '-map', '0:a:0', '-ac', isMusic ? '2' : '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', isMusic ? '96k' : '80k', out]);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', out]).toString());
  const duration = Number(probe.format.duration), bytes = Number(probe.format.size);
  if (!(duration > 0.1)) throw new Error(`${slot}: encoded file is empty`);
  return { file: `assets/audio/${slot}.mp3`, duration: Math.round(duration * 10) / 10, bytes };
}

const assets = {};

// ---------------------------------------------------------------- Mixkit sound effects
for (const [slot, pin] of Object.entries(config.sfx)) {
  if (!Number.isInteger(pin.mixkitId)) throw new Error(`${slot}: mixkitId must be an integer`);
  const url = `https://assets.mixkit.co/active_storage/sfx/${pin.mixkitId}/${pin.mixkitId}.wav`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok || !/audio/.test(res.headers.get('content-type') || '')) throw new Error(`${slot}: ${url} HTTP ${res.status}`);
  const src = `${tmp}/${slot}.wav`;
  await writeFile(src, Buffer.from(await res.arrayBuffer()));
  const enc = encode(src, slot, 'sfx', pin.max, pin.start);
  assets[slot] = { ...enc, kind: 'sfx', use: pin.use, title: pin.title, source: `https://mixkit.co/free-sound-effects/${pin.category}/`, assetId: pin.mixkitId, creator: 'Mixkit', provider: 'Mixkit', licence: 'Mixkit Sound Effects Free License', licenceUrl: 'https://mixkit.co/license/#sfxFree' };
  note(`SFX ${slot}`, `Mixkit #${pin.mixkitId} "${pin.title}" | ${enc.duration}s | ${Math.round(enc.bytes / 1024)}KB`);
}

// ---------------------------------------------------------------- Pixabay music (uploaded by hand)
const uploads = existsSync(incomingDir) ? (await readdir(incomingDir)).filter(f => /\.(mp3|m4a|wav|ogg)$/i.test(f)) : [];
for (const [slot, spec] of Object.entries(config.music)) {
  const key = `music_${slot}`;
  const file = uploads.find(f => f.toLowerCase().startsWith(`${slot}-`) || f.toLowerCase().startsWith(`${slot}.`) || f.toLowerCase().startsWith(`${slot}_`));
  if (!file && spec.oga) {
    const p = await ogaPage(spec.oga.page);
    if (!p.licences.some(OGA_OK)) throw new Error(`${key}: ${spec.oga.page} licences are "${p.licences.join(', ')}", CC0 required`);
    const url = p.files.find(f => decodeURIComponent(f.split('/').pop()) === spec.oga.file);
    if (!url) throw new Error(`${key}: file "${spec.oga.file}" not listed on ${spec.oga.page}`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${key}: ${url} HTTP ${res.status}`);
    const src = `${tmp}/${key}.${url.split('.').pop()}`;
    await writeFile(src, Buffer.from(await res.arrayBuffer()));
    const enc = encode(src, key, 'music', spec.max, spec.start);
    assets[key] = { ...enc, kind: 'music', use: spec.use, title: p.title || spec.oga.file, originalFile: spec.oga.file, source: spec.oga.page, creator: p.author, provider: 'OpenGameArt', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
    note(`Music ${slot}`, `OpenGameArt "${p.title}" by ${p.author} (CC0 verified) | ${enc.duration}s | ${Math.round(enc.bytes / 1024)}KB`);
    continue;
  }
  if (!file) {
    if (!previous.assets[key]) throw new Error(`${key}: no upload and no previous recording`);
    assets[key] = { ...previous.assets[key], use: spec.use };
    note(`Music ${slot}`, `kept ${previous.assets[key].provider || 'Wikimedia Commons'}: ${previous.assets[key].title}`);
    continue;
  }
  const original = file.slice(slot.length + 1);
  const id = (original.match(/(\d{5,})(?=\.[a-z0-9]+$)/i) || [])[1] || null;
  const title = original.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]?\d{5,}$/, '').replace(/[-_]+/g, ' ').trim() || original;
  const enc = encode(new URL(file, incomingDir).pathname, key, 'music', spec.max, spec.start);
  assets[key] = { ...enc, kind: 'music', use: spec.use, title, originalFile: original, source: id ? `https://pixabay.com/music/search/?id=${id}` : 'https://pixabay.com/music/', assetId: id ? Number(id) : null, creator: 'Pixabay artist (see original file name)', provider: 'Pixabay', licence: 'Pixabay Content License', licenceUrl: 'https://pixabay.com/service/license-summary/' };
  await rm(new URL(file, incomingDir));
  note(`Music ${slot}`, `Pixabay ${id ? '#' + id : ''} "${title}" | ${enc.duration}s | ${Math.round(enc.bytes / 1024)}KB`);
}

// Previously encoded files for slots that no longer exist are removed.
for (const old of Object.keys(previous.assets)) if (!assets[old]) await rm(new URL(`${old}.mp3`, outDir), { force: true });

const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  policy: 'Recorded stock audio only. Sound effects: Mixkit (Sound Effects Free License). Music: CC0 tracks by human composers from OpenGameArt.org (licence re-verified on every build) and Pixabay tracks by human artists (Pixabay Content License) downloaded by hand from pixabay.com, which take priority; slots not yet replaced keep their Wikimedia Commons CC0/Public domain recording. Mixkit music is not used (its licence excludes games).',
  assets,
};
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');

// ---------------------------------------------------------------- AUDIO_LICENSES.md
const link = a => a.provider === 'OpenGameArt' ? `[OpenGameArt: ${a.title}](${a.source})` : a.provider === 'Mixkit' ? `[Mixkit #${a.assetId}: ${a.title}](${a.source})` : a.provider === 'Pixabay' ? `[Pixabay${a.assetId ? ' #' + a.assetId : ''}: ${a.title}](${a.source})` : `[${a.title}](${a.source})`;
const lic = a => a.licenceUrl ? `[${a.licence}](${a.licenceUrl})` : a.licence;
const rows = Object.values(assets).map(a => `| \`${a.file}\` | ${a.use} | ${link(a)} | ${a.creator} | ${lic(a)} | ${a.duration} s |`);
const doc = `# Blind Quiz audio inventory

Generated by \`scripts/audio/stock-audio.mjs\` on ${manifest.generated}. All audio is **recorded stock audio**. Nothing is synthesised in the app: no Web Audio oscillators, generated beeps or text-to-speech.

## Sources and licences

- **Sound effects: [Mixkit](https://mixkit.co/free-sound-effects/)** under the [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree). It allows commercial and non-commercial use, including games and apps, with no attribution required. Sound effects may not be redistributed on their own, for example as a sound pack. The workflow downloads each pinned asset as Mixkit's full WAV, by asset id.
- **Music: [Pixabay](https://pixabay.com/music/)** under the [Pixabay Content License](https://pixabay.com/service/license-summary/). It allows commercial use, including apps and games, with no attribution required. Tracks may not be sold or redistributed on their own. Only tracks by human artists are used, preferring tracks that are *not* "Content ID Registered". Pixabay requires music to be downloaded from its own site, so the owner downloads each track there and uploads it to \`assets/audio/incoming/\`. The workflow then encodes it and deletes the original. A music slot that has not been replaced yet keeps its earlier Wikimedia Commons recording (CC0 / Public domain).
- **Music: [OpenGameArt.org](https://opengameart.org/)**, **CC0 only** (public domain dedication: free for any use including commercial games, no attribution required; artists are credited anyway). Tracks are pinned by page and file name in \`scripts/audio/sources.json\`; the workflow reads the live page and refuses to build unless CC0 is listed. Only long-standing uploads by human composers are used. A Pixabay upload for the same slot takes priority.
- **Mixkit music is not used**, because the Mixkit Stock Music Free License excludes video games.

How files are produced: workflow \`audio-assets.yml\` runs \`scripts/audio/stock-audio.mjs\`. The script trims silence, normalises loudness, encodes MP3 and records the source, licence and duration of every file in \`assets/audio/manifest.json\`.

| File | Used for | Source | Creator | Licence | Length |
|---|---|---|---|---|---|
${rows.join('\n')}

## How to replace a music track

1. Open a Pixabay music page, check the artist is a person or band (not an AI tool), and click **Download**.
2. Rename the file by putting the slot in front, keeping Pixabay's name: \`menu-\`, \`game1-\`, \`game2-\`, \`game3-\` or \`results-\` (for example \`menu-morning-garden-123456.mp3\`).
3. Upload it to \`assets/audio/incoming/\` on the working branch. The workflow encodes it, updates this file, and redeploys the site.

Accessibility: every sound has a text and screen-reader equivalent (feedback text and live-region announcements), so no information is carried by sound alone. Sound effects, background music, and music volume can be changed in **Settings**. Music starts only after the first tap or key press, pauses when the app is in the background, and plays quietly by default so it does not cover a screen reader.
`;
await writeFile(new URL('AUDIO_LICENSES.md', root), doc);
const total = Object.values(assets).reduce((a, x) => a + x.bytes, 0);
note('Audio total', `${Object.keys(assets).length} files, ${Math.round(total / 1024)}KB`);
