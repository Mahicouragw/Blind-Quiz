// Recorded, royalty-free audio for Blind Quiz from Wikimedia Commons.
//
// Only files whose Commons licence is CC0 or Public domain are accepted (no attribution or
// share-alike obligations, free for commercial use and redistribution). Nothing is generated:
// every asset is an existing recording, downloaded, licence-checked again at download time,
// trimmed, loudness-normalised and encoded to MP3 with ffmpeg.
//
//   node scripts/audio/commons-audio.mjs --list    print CC0/PD candidates for every slot
//   node scripts/audio/commons-audio.mjs --fetch   download the pinned files in sources.json,
//                                                  verify licences, encode into assets/audio/,
//                                                  and write assets/audio/manifest.json
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const UA = 'BlindQuizAudio/1.0 (https://github.com/Mahicouragw/Blind-Quiz; accessibility quiz game)';
const API = 'https://commons.wikimedia.org/w/api.php';
const OK_LICENSES = new Set(['cc0', 'public domain', 'pd']);
const GH = !!process.env.GITHUB_ACTIONS;
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Commons API failed: ${url}`);
}
const licenceOf = ii => (ii?.extmetadata?.LicenseShortName?.value || '').trim();
const isFree = ii => OK_LICENSES.has(licenceOf(ii).toLowerCase()) || /^(cc0|public domain)/i.test(licenceOf(ii));
const strip = html => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const mode = process.argv[2];
const config = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'));

if (mode === '--list') {
  const lines = [];
  for (const [slot, spec] of Object.entries(config.search)) {
    const seen = new Set();
    const rows = [];
    for (const q of spec.queries) {
      const data = await api({ action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '40', gsrsearch: `${q} filetype:audio`, prop: 'imageinfo', iiprop: 'size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist' });
      for (const p of data.query?.pages || []) {
        const ii = p.imageinfo?.[0];
        if (!ii || seen.has(p.title) || !isFree(ii) || /^File:(LL-|Ig-|En-|Nl-)|pronunciation/i.test(p.title)) continue;
        const d = ii.duration || 0;
        if (d < spec.min || d > spec.max) continue;
        seen.add(p.title);
        rows.push(`${p.title.replace(/^File:/, '')} | ${licenceOf(ii)} | ${d.toFixed(1)}s | ${Math.round(ii.size / 1024)}KB | ${strip(ii.extmetadata?.Artist?.value).slice(0, 40)}`);
      }
      await sleep(300);
    }
    lines.push(`## ${slot} (${rows.length})`, ...rows.slice(0, spec.show || 18));
  }
  // Print in chunks as grouped annotations (log archives are not always downloadable).
  let chunk = [], size = 0, part = 1;
  const flush = () => { if (chunk.length) console.log(GH ? `::notice title=Audio candidates ${part++}::${esc(chunk.join('\n'))}` : chunk.join('\n')); chunk = []; size = 0; };
  for (const l of lines) { if (l.startsWith('## ') && size > 2500) flush(); chunk.push(l); size += l.length + 1; }
  flush();
  process.exit(0);
}

if (mode !== '--fetch') { console.error('Usage: --list | --fetch'); process.exit(2); }

// ---------------------------------------------------------------- fetch + encode
const outDir = new URL('../../assets/audio/', import.meta.url);
await mkdir(outDir, { recursive: true });
const tmp = '/tmp/bq-audio';
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
const manifest = { generated: new Date().toISOString().slice(0, 10), policy: 'Recorded audio only; Wikimedia Commons files licensed CC0 or Public domain, verified through the Commons API at download time.', assets: {} };

for (const [slot, pin] of Object.entries(config.pinned)) {
  const data = await api({ action: 'query', titles: `File:${pin.file}`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|UsageTerms|ImageDescription' });
  const page = data.query?.pages?.[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) throw new Error(`${slot}: ${pin.file} not found on Commons`);
  if (!isFree(ii)) throw new Error(`${slot}: ${pin.file} licence is "${licenceOf(ii)}", not CC0/Public domain`);
  const src = `${tmp}/${slot}.src`;
  const res = await fetch(ii.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${slot}: download HTTP ${res.status}`);
  await writeFile(src, Buffer.from(await res.arrayBuffer()));
  const out = `${slot}.mp3`;
  const isMusic = pin.kind === 'music';
  const filters = [];
  if (pin.start) filters.push(`atrim=start=${pin.start}`, 'asetpts=PTS-STARTPTS');
  else filters.push('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02');
  filters.push(`atrim=duration=${pin.max}`, 'asetpts=PTS-STARTPTS');
  filters.push(isMusic ? 'loudnorm=I=-20:TP=-2:LRA=11' : 'loudnorm=I=-16:TP=-1.5:LRA=7');
  const fadeOut = isMusic ? 3 : Math.min(0.25, pin.max / 4);
  filters.push(`afade=t=in:d=${isMusic ? 1.5 : 0.005}`);
  // Fade out at the end of the trimmed clip (areverse trick keeps it duration-independent).
  filters.push('areverse', `afade=t=in:d=${fadeOut}`, 'areverse');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', filters.join(','), '-ac', isMusic ? '2' : '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', isMusic ? '96k' : '80k', `${new URL(out, outDir).pathname}`]);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', new URL(out, outDir).pathname]).toString());
  const duration = Number(probe.format.duration), bytes = Number(probe.format.size);
  if (!(duration > 0.1)) throw new Error(`${slot}: encoded file is empty`);
  manifest.assets[slot] = {
    file: `assets/audio/${out}`, kind: pin.kind, use: pin.use, title: pin.file,
    source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(pin.file.replace(/ /g, '_'))}`,
    creator: strip(ii.extmetadata?.Artist?.value).slice(0, 120) || 'Unknown',
    licence: licenceOf(ii), duration: Math.round(duration * 10) / 10, bytes,
  };
  console.log(GH ? `::notice title=Audio ${slot}::${pin.file} | ${licenceOf(ii)} | ${duration.toFixed(1)}s | ${Math.round(bytes / 1024)}KB` : `${slot}: ${pin.file} ${licenceOf(ii)} ${duration.toFixed(1)}s ${bytes}B`);
  await sleep(400);
}
await writeFile(new URL('manifest.json', outDir), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest.assets).reduce((a, x) => a + x.bytes, 0);
console.log(GH ? `::notice title=Audio total::${Object.keys(manifest.assets).length} files, ${Math.round(total / 1024)}KB` : `total ${total}`);
