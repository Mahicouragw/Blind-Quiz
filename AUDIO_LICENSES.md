# Blind Quiz audio inventory

Checked 5 October 2026. All audio is **recorded** (real instruments, objects, crowds and orchestras) and comes from Wikimedia Commons under **CC0** or **Public domain**. That means it's free for commercial use and redistribution, with no attribution or share-alike obligations; credits are listed anyway. Nothing is synthesised: no Web Audio oscillators, generated beeps, text-to-speech or AI-generated audio.

How it is produced: `scripts/audio/commons-audio.mjs` (workflow `audio-assets.yml`) downloads only the files pinned in `scripts/audio/sources.json`, re-checks each licence through the Commons API at download time (anything other than CC0 / Public domain fails the build), trims silence, normalises loudness, and encodes MP3. `assets/audio/manifest.json` records the source, creator, licence and duration of every file.

| File | Used for | Source recording | Creator | Licence | Length |
|---|---|---|---|---|---|
| `assets/audio/correct.mp3` | Correct answer | [406243 stubb typewriter-ding-near-mono.wav](https://commons.wikimedia.org/wiki/File:406243_stubb_typewriter-ding-near-mono.wav) | _stubb | CC0 | 1.1 s |
| `assets/audio/wrong.mp3` | Wrong answer | [Buzzer.ogg](https://commons.wikimedia.org/wiki/File:Buzzer.ogg) | BlastOButter42 | Public domain | 1 s |
| `assets/audio/tick.mp3` | Countdown 3-2-1 | [Watch tick.ogg](https://commons.wikimedia.org/wiki/File:Watch_tick.ogg) | Marble Toast | CC0 | 0.2 s |
| `assets/audio/go.mp3` | GO! after the countdown | [218318 splicesound referee-whistle-blow-gymnasium.wav](https://commons.wikimedia.org/wiki/File:218318_splicesound_referee-whistle-blow-gymnasium.wav) | SpliceSound | CC0 | 1.6 s |
| `assets/audio/timeup.mp3` | Time is up | [Old school bell 4.ogg](https://commons.wikimedia.org/wiki/File:Old_school_bell_4.ogg) | ezwa | Public domain | 2.5 s |
| `assets/audio/applause.mp3` | Round complete | [Applause ii.ogg](https://commons.wikimedia.org/wiki/File:Applause_ii.ogg) | thore | Public domain | 6 s |
| `assets/audio/levelup.mp3` | Level up | [Band Call.ogg](https://commons.wikimedia.org/wiki/File:Band_Call.ogg) | Sgt. Codie Lynn Williams, U.S. Marine Corps (U.S. government work) | Public domain | 4.7 s |
| `assets/audio/coin.mp3` | XP and coins earned | [Coins dropped in metallic moneybox 0.ogg](https://commons.wikimedia.org/wiki/File:Coins_dropped_in_metallic_moneybox_0.ogg) | ezwa | Public domain | 1.4 s |
| `assets/audio/cheer.mp3` | Perfect round | [Clapping hurray.ogg](https://commons.wikimedia.org/wiki/File:Clapping_hurray.ogg) | starlite | Public domain | 7 s |
| `assets/audio/click.mp3` | Get ready / start | [Computer mouse single click.ogg](https://commons.wikimedia.org/wiki/File:Computer_mouse_single_click.ogg) | Darklanlan | CC0 | 0.5 s |
| `assets/audio/music_menu.mp3` | Home, sign in, settings, profile | [Bach, Goldberg Variations, Aria (Musopen version).ogg](https://commons.wikimedia.org/wiki/File:Bach%2C_Goldberg_Variations%2C_Aria_(Musopen_version).ogg) | Johann Sebastian Bach | CC0 | 80 s |
| `assets/audio/music_game1.mp3` | Game music: nature, animals, vocabulary, commerce, general | [Maple Leaf Rag - played by Scott Joplin 1916 sample.ogg](https://commons.wikimedia.org/wiki/File:Maple_Leaf_Rag_-_played_by_Scott_Joplin_1916_sample.ogg) | Scott Joplin | Public domain | 80 s |
| `assets/audio/music_game2.mp3` | Game music: music, instruments, India, history, civics, braille, accounting, random | [Musopen - Morning.ogg](https://commons.wikimedia.org/wiki/File:Musopen_-_Morning.ogg) | Grieg, Edvard; Musopen Symphony Orchestra | Public domain | 80 s |
| `assets/audio/music_game3.mp3` | Game music: science, technology, sports, economics, business, management, abbreviations, rapid fire | [Musopen - In the Hall Of The Mountain King.ogg](https://commons.wikimedia.org/wiki/File:Musopen_-_In_the_Hall_Of_The_Mountain_King.ogg) | Grieg, Edvard; Musopen Symphony Orchestra | Public domain | 80 s |
| `assets/audio/music_results.mp3` | Results screen | [Mozart - Le nozze di Figaro, K492 - Overture (Musopen Symphony).flac](https://commons.wikimedia.org/wiki/File:Mozart_-_Le_nozze_di_Figaro%2C_K492_-_Overture_(Musopen_Symphony).flac) | Wolfgang Amadeus Mozart | Public domain | 60 s |

Music notes: the classical and ragtime compositions are in the public domain, and these specific recordings were released into the public domain (Musopen, CC0/PD) or are public-domain historical recordings (Scott Joplin's 1916 piano roll of *Maple Leaf Rag*). Mixkit music is not used.

Accessibility: every sound has a text and screen-reader equivalent (feedback text and live-region announcements), so no information is carried by sound alone. Sound effects, background music, and music volume can be changed in **Settings**. Music starts only after the first tap or key press, pauses when the app is in the background, and plays quietly by default so it does not cover a screen reader.
