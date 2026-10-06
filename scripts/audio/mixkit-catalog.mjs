#!/usr/bin/env node
// Lists Mixkit sound effects (asset id + title) from Mixkit category pages so Sound Match sounds can be
// pinned by id in scripts/audio/sources.json. Read-only: fetches public category pages, writes
// scripts/audio/mixkit-catalog.json. Mixkit Sound Effects Free License allows use in games.
import { writeFile } from 'node:fs/promises';
const UA = 'BlindQuizAudioBuilder/2.0 (https://github.com/Mahicouragw/Blind-Quiz)';
const CATEGORIES = ['funny', 'cartoon', 'horror', 'sci-fi', 'cinematic', 'magic', 'mystery', 'suspense', 'animals', 'transition', 'whoosh', 'laugh', 'toy', 'space', 'monster', 'bell', 'drum', 'animal', 'creepy', 'fantasy', 'video-game'];
const strip = s => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const out = { generated: new Date().toISOString(), categories: {}, sounds: {} };
for (const cat of CATEGORIES) {
  for (const page of [1, 2]) {
    const url = `https://mixkit.co/free-sound-effects/${cat}/${page > 1 ? `?page=${page}` : ''}`;
    let html = '';
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); out.categories[`${cat}#${page}`] = r.status; if (!r.ok) break; html = await r.text(); }
    catch (e) { out.categories[`${cat}#${page}`] = String(e.message); break; }
    // Each card: title heading followed by an audio preview URL containing the asset id.
    const re = /active_storage\/sfx\/(\d+)\//g; let m; let last = 0;
    const seen = new Set();
    while ((m = re.exec(html))) {
      const id = Number(m[1]); if (seen.has(id)) continue; seen.add(id);
      const before = html.slice(Math.max(last, m.index - 4000), m.index);
      const titles = [...before.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(x => strip(x[1])).filter(Boolean);
      const after = html.slice(m.index, m.index + 4000);
      const nextTitle = [...after.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(x => strip(x[1])).filter(Boolean)[0] || '';
      const duration = (strip(after).match(/\b(\d:\d\d)\b/) || [])[1] || '';
      // Mixkit puts each audio player before its title, so the id belongs to the next heading.
      const s = out.sounds[id] || { id, title: nextTitle, duration, cats: [] };
      if (!s.cats.includes(cat)) s.cats.push(cat);
      out.sounds[id] = s; last = m.index;
    }
  }
}
await writeFile(new URL('./mixkit-catalog.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`::notice title=Mixkit catalog::${Object.keys(out.sounds).length} sounds; pages ${JSON.stringify(out.categories)}`);
