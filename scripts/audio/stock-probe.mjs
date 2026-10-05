// Discovery only: lists direct audio URLs and titles from Mixkit sound-effect pages and Pixabay music
// pages so recordings can be chosen by name, licence page and publication date. Downloads nothing.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const GH = !!process.env.GITHUB_ACTIONS;
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const pages = process.argv.slice(2);
for (const id of [2870, 946]) for (const u of [`https://assets.mixkit.co/active_storage/sfx/${id}/${id}.wav`, `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`]) {
  try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); const b = Buffer.from(await r.arrayBuffer()); console.log(`::notice title=Asset check::${u} HTTP ${r.status} ${r.headers.get('content-type')} ${b.length} bytes`); } catch (e) { console.log(`::notice title=Asset check::${u} ${e.message}`); }
}
let part = 1;
for (const url of pages) {
  let text = '', status = 0;
  try { const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' } }); status = res.status; text = await res.text(); } catch (e) { status = String(e.message); }
  const rows = [];
  if (/mixkit\.co/.test(url)) {
    // Each Mixkit item carries its title and a data-audio-player preview URL.
    const re = /<div[^>]+data-audio-player-preview-url-value="([^"]+)"[\s\S]{0,4000}?<h2[^>]*>\s*([^<]+?)\s*<\/h2>/g;
    for (const m of text.matchAll(re)) rows.push(`${m[2].trim()} | ${m[1]}`);
    const links = [...new Set([...text.matchAll(/href="(\/free-sound-effects\/[^"]*-\d+\/?)"/g)].map(m => m[1]))].slice(0, 3);
    if (links.length) rows.push('links: ' + links.join(' '));
    if (!rows.length) for (const m of text.matchAll(/https:\/\/assets\.mixkit\.co\/[^"' )]+\.(?:mp3|wav)/g)) rows.push(m[0]);
  } else {
    for (const m of text.matchAll(/https:\/\/cdn\.pixabay\.com\/(?:download\/)?audio\/[^"'\\ )]+\.mp3/g)) rows.push(m[0]);
    const meta = [...text.matchAll(/"(name|uploadDate|datePublished|duration|contentUrl)"\s*:\s*"([^"]{1,160})"/g)].map(m => `${m[1]}=${m[2]}`).slice(0, 12);
    if (/Content ID Registered/i.test(text)) meta.push('CONTENT_ID_REGISTERED');
    rows.push(...meta);
  }
  const uniq = [...new Set(rows)];
  const out = [`## ${url} (HTTP ${status}, ${text.length} bytes, ${uniq.length} rows)`, ...uniq.slice(0, 60)].join('\n');
  console.log(GH ? `::notice title=Stock probe ${part++}::${esc(out.slice(0, 3900))}` : out);
}
