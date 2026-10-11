# Blind Quiz

Blind Quiz is an accessible, audio-optional quiz game designed for blind, low-vision, keyboard, and sighted players. The static progressive web app uses semantic controls, visible focus, screen-reader live regions, large-text/high-contrast/reduced-motion settings, and text for all essential game content.

## Current content and gameplay

- **2175 validated multiple-choice questions across 30 combined categories**: the preserved 1075-question PR #5 bank plus 500 questions prepared in Migration 025 and 600 additional questions prepared in Migration 028. Migration 025 adds 20 questions in each of its 25 categories; Migration 028 adds 20 in each of all 30 categories. Their stable IDs are `bq-en-1417`–`bq-en-1916` and `bq-en-1917`–`bq-en-2516`, respectively. Neither prepared question migration has been applied remotely.
- The historical repository questions retain IDs `bq-en-0001`–`bq-en-0073`. A live database check on 3 October 2026 found 114 rows with a highest existing ID of `bq-en-0414`, so the expansion safely uses `bq-en-0415`–`bq-en-0666` without filling or overwriting ID gaps.
- Eight quiz modes: balanced Classic, Rapid Fire, Time Attack, Survival, Random Mix, Vocabulary, Abbreviations, and Braille. Category rounds remain available in the category picker. Letters to Words and Sound Match are separate games; rooms add live multiplayer rounds.
- Four answer buttons are independently shuffled with Fisher–Yates while correctness remains tied to answer text. Buttons expose only the answer itself, not radio/checkbox or “Option A” semantics.
- **Letters to Words** (new game): build words from letter buttons; no typing and no drag and drop. Every letter is a real button ("Letter D"), selections are announced ("D selected"), and words are recognised automatically ("Word found: FOR"). Real words only, from SCOWL (see `WORDS_LICENSE.md`) plus a short curated list of common two-letter words (`src/short-words.js`); words of two or more letters count. Pressing a letter again (TalkBack keeps focus on it) uses its other copy, so F T O O makes TOO. Each puzzle is a round; words plus a round bonus fill the level XP bar, and when it is full the game levels up automatically (about 4–5 rounds per level) with a recorded bugle call and a "Level up!" announcement. Seven levels (Beginner to Master) grow from 4 to 7 letters with harder words and bigger goals, and every puzzle is generated from a real word, so it always has answers. The server checks each word and pays XP and coins the first time you find it.
- **Profile**: stats read as "Level, 1" or "Coins, 18". **Change** lets you edit your username, secret question and secret answer after confirming your current answer. Your User ID never changes. Username changes have a server-side cooldown of 7, 14, 30, then 60 days, and usernames are unique regardless of capital letters.
- **Private chat**: friends can send encrypted text, emojis and stickers, record voice messages up to 60 seconds, make audio/video calls, and transfer files or PDFs up to 2 GB while both are online. Private-chat and room recordings stop at 60 seconds and wait for the sender to preview and explicitly send or discard. Before recording, the sender can choose Natural, Higher, Lower, Chipmunk, Alien or Robot; the effect is applied locally to the real microphone audio without changing its duration or tempo. Recipients cannot change the sender's style and can cycle playback speed only. Transfers are not stored on the server; temporary received copies inside Blind Quiz expire after three hours. Copies saved elsewhere stay under the recipient's control. Android feature-news notifications are checked in the background even after sign-out and resume after the phone reconnects.
- **TalkBack**: after each answer, focus moves to the result (correct or incorrect, the correct answer, XP, coins, streak) and then to Next question. Hidden screens are inert, and the header is not a live region.
- Essential content is text. The game's recorded, royalty-free sound effects (bell for correct, buzzer for wrong, watch ticks and a referee whistle for the countdown, school bell when time runs out, applause and cheering at the end) and background music (Bach, Joplin, Grieg and Mozart recordings, a different track per screen and category group) are bundled from Wikimedia Commons under CC0 / Public domain. See `AUDIO_LICENSES.md`. Voice messages remain real microphone recordings; local effects do not synthesize speech. Sound effects, music and music volume can be changed in Settings.
- Custom account fields remain Name + Secret Question + Secret Answer for signup, and Name + Login ID + Secret Answer for login. Signup fills in a suggested player name; **Generate name** gives another option, and players can always type their own.
- **Admin-only player monitor**: a read-only Settings tool separates registered-profile totals from heartbeat-based online presence (two-minute window), profiles seen in the last 24 hours (heartbeat data, not a verified gameplay count), and new profiles from the last seven days. It shows up to 50 of the most recently seen online profile names and relative last-seen times, plus coarse multiplayer room/game status when the server has it; it does not expose quiz answers, private chats, Login IDs, or solo-screen activity. Profile totals are not a count of verified people.

## Run and validate

Node.js 22.13 or newer is recommended; the Edge Function integrity guard uses Node's TypeScript type-stripping API and degrades gracefully on older versions.

```sh
npm test                 # content, accessibility, schema, and Edge Function source guards
npm run test:a11y        # content and accessibility checks only
npm run test:function    # Edge Function source integrity only
npm run test:live        # staging-only end-to-end checks (creates synthetic test profiles)
npm run validate:content
npm run build
python3 -m http.server 4173
```

`npm run validate:content` validates the combined bank, regenerates `supabase/seed.sql`, and prepares additive Migrations 025 and 028 without changing the already-applied PR #5 migrations or migrations 026–027. Neither prepared question migration is applied by this command. `npm run build` creates the static production output in the ignored `dist/` directory.

`npm run test:live` exercises an explicitly configured non-production Edge Function with the public publishable key only. The suite creates synthetic profile records and does not delete them, so it requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `BQ_ALLOW_TEST_ACCOUNT_CREATION=true` for a dedicated test project. A built-in guard refuses the production Blind Quiz project before making any request. The suite never prints secret answers, session tokens, apikeys, or Authorization headers.

Automated accessibility checks are source-level checks, not a substitute for manual TalkBack, VoiceOver, keyboard, zoom, and contrast testing on target devices.

## Supabase

The browser contains only the public project URL and publishable key in `src/config.js`. Never add a service-role key, database password, Supabase access token, or rate-limit pepper to client code or Git.

The repository includes the historical core migration, seed output, the `blind-quiz-api` function, and migrations 009–027. Preserve those existing migration files; do not rerun or rewrite already-applied migrations, especially migrations 026 and 027. The prepared question additions are isolated in `202610080025_expand_question_bank.sql` (500 rows, IDs `bq-en-1417`–`bq-en-1916`) and `202610110028_add_600_questions.sql` (600 rows, IDs `bq-en-1917`–`bq-en-2516`). They are additive, not applied or live-verified, and must be reviewed and approved before any separate migration apply; never use `supabase db push` for them.

The Edge Function performs custom authentication, stores salted PBKDF2 secret-answer hashes, rate-limits attempts, uses opaque expiring sessions, and calls a database function that validates answers and awards XP/coins server-side. Its source in this repository has no `DAILY_BANK_SIZE` or daily-question selection feature. Deployment of the source cannot be inferred from a Git push.

### Gemini signup-name suggestions

The public `suggest-name` action calls Gemini only from the Edge Function. Configure `GEMINI_API_KEY` as a **Supabase Edge Function secret** (Dashboard → Edge Functions → Secrets); do not put it in `src/config.js`, the website, or Git. The default model is `gemini-2.5-flash`; optionally set `BQ_GEMINI_MODEL` as a function secret to use another Gemini model. Suggestions are limited to 12 requests per IP per hour, and the provider receives only a fixed prompt—not a player's name, secret question, answer, or other account data. If the key is missing or Gemini is unavailable, signup remains usable with a local suggestion.

### Deploying the Edge Function

`supabase functions deploy` bundles the whole `supabase/functions/blind-quiz-api/` directory and **replaces** the deployed version in one operation. It never appends to or merges with whatever is already live.

This matters because of a real incident: the deployed copy had been built up by repeated edits in the dashboard editor and served a concatenated ~680-line module, so the isolate failed to start with

```
Uncaught SyntaxError: Identifier 'createClient' has already been declared
  at index.ts:680:10
```

and every request returned `{"code":"BOOT_ERROR"}`. The repository source is a single 86-line module that imports `createClient` once; the fix is one complete redeploy of that source, not another edit.

Two supported paths, both of which run `scripts/check-function-source.mjs` first and neither of which touches the database:

```sh
# locally, with your own Supabase personal access token exported in your shell
export SUPABASE_ACCESS_TOKEN="$(cat /path/to/token)"
npm run deploy:function

# or in CI, using the SUPABASE_ACCESS_TOKEN repository secret
# .github/workflows/deploy-function.yml
```

`scripts/check-function-source.mjs` fails the deployment if `index.ts` is not one valid ES module — it re-parses the file as ESM after stripping types, and reports duplicate top-level declarations, extra `createClient` imports or calls, extra `Deno.serve` registrations, and any weakening of the PBKDF2, constant-time-comparison, rate-limit, origin-allowlist, or no-secret-logging invariants.

Migrations 001–009 are already applied remotely. Neither deployment path runs `supabase db push`, `db reset`, a migration command, or `seed.sql`, and the CI workflow asserts that against its own executable lines before deploying.

### Deploying without a code editor (screen-reader friendly)

Editing the function in the Supabase dashboard code editor is impractical with a screen reader, and appending to it is what caused the `BOOT_ERROR` incident in the first place. Two routes avoid the editor entirely or avoid deleting anything:

**Preferred — no editor at all.** Store a Supabase personal access token as the `SUPABASE_ACCESS_TOKEN` repository secret (GitHub → Settings → Secrets and variables → Actions). Any push to `supabase/functions/**`, or a re-run of the workflow, then deploys from the repository source. The workflow runs offline verification only; it does not create synthetic profiles in production. The token stays inside GitHub and is never printed.

**Dashboard — paste over, never delete.** Copy the file with the *Copy raw file* button on its GitHub file page, then in the dashboard editor focus the code, choose **Select all** from the long-press (or TalkBack local) menu, and **Paste** without moving focus. Pasting onto a selection replaces it, so the old content is discarded in one action. Verify with Chrome's *Find in page*: `import { createClient }` must report **1 of 1**. If it reports 1 of 2, the module is still duplicated.

If the editor does not expose its full text to a screen reader, delete the function and recreate it with the same slug `blind-quiz-api` so the editor starts empty — then **turn JWT verification off** to match `verify_jwt = false` in `supabase/config.toml`. The app sends the publishable key plus its own opaque session token, not a Supabase JWT, so leaving JWT verification enabled makes the platform reject every request with a 401 before the handler runs.

## Known limits

- Achievements, combo rewards, and daily question selection are not implemented as playable features. The app does include a player profile, account changes, Letters to Words, Sound Match, and multiplayer rooms.
- Existing schema tracks XP, coins, level, answer streak, and answer counts. Live API verification is staging-only because it creates synthetic profiles; it cannot be used as evidence of real player activity.
- The question bank passed structural and duplicate checks and includes category-level source notes; this is not an independent expert review of every item. Changeable facts and specialized claims should be rechecked.
- Recorded audio and music are bundled under the licenses documented in `AUDIO_LICENSES.md`; no synthetic Web Audio effects are used.

## Deployment

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` from `main`; the workflow runs `npm test`, builds `dist/`, and deploys it to Pages. It also supports manual dispatch.

Supabase Edge Function deployment is handled separately by `.github/workflows/deploy-function.yml`, which runs the source integrity guard, deploys `blind-quiz-api` as one complete replacement, and runs offline tests. It triggers on changes to `supabase/functions/**`, the deploy tooling, or the workflow itself, and supports manual dispatch. It requires the `SUPABASE_ACCESS_TOKEN` repository secret. `.github/workflows/live-checks.yml` is manual-only and uses explicit `BQ_TEST_SUPABASE_URL` / `BQ_TEST_SUPABASE_PUBLISHABLE_KEY` repository variables for an isolated non-production project; its scripts refuse the production project.

`tests/live-api.mjs` verifies a dedicated staging function: boot without `BOOT_ERROR`; Gemini name suggestions; account creation and Login ID shape; login/recovery/logout; answer rewards and replay rejection; generic client errors; and rate limiting. It creates two synthetic profiles per successful run and is blocked from production.
