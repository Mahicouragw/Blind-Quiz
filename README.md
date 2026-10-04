# Blind Quiz

Blind Quiz is an accessible, audio-optional quiz game designed for blind, low-vision, keyboard, and sighted players. The static progressive web app uses semantic controls, visible focus, screen-reader live regions, large-text/high-contrast/reduced-motion settings, and text for all essential game content.

## Current content and gameplay

- **325 validated multiple-choice questions in 20 categories**: the original 73 questions plus Migration 009’s 252-question expansion (12 in every category plus 12 additional Telugu/Bharati Braille questions).
- The historical repository questions retain IDs `bq-en-0001`–`bq-en-0073`. A live database check on 3 October 2026 found 114 rows with a highest existing ID of `bq-en-0414`, so the expansion safely uses `bq-en-0415`–`bq-en-0666` without filling or overwriting ID gaps.
- Functional category, classic, rapid, random, vocabulary, abbreviations, and Braille rounds.
- Four answer buttons are independently shuffled with Fisher–Yates while correctness remains tied to answer text. Buttons expose only the answer itself, not radio/checkbox or “Option A” semantics.
- Essential content is text. No recorded music/audio is bundled, and synthetic Web Audio effects are not used.
- Custom account fields remain Name + Secret Question + Secret Answer for signup, and Name + Login ID + Secret Answer for login.

## Run and validate

Node.js 20 or newer is recommended.

```sh
npm test
npm run test:a11y
npm run validate:content
npm run build
python3 -m http.server 4173
```

`npm run validate:content` validates the bank, regenerates `supabase/seed.sql`, and regenerates the prepared incremental Migration 009. `npm run build` creates the static production output in the ignored `dist/` directory.

Automated accessibility checks are source-level checks, not a substitute for manual TalkBack, VoiceOver, keyboard, zoom, and contrast testing on target devices.

## Supabase

The browser contains only the public project URL and publishable key in `src/config.js`. Never add a service-role key, database password, Supabase access token, or rate-limit pepper to client code or Git.

The repository snapshot includes the historical core migration `202609260001_core.sql`, seed output, the `blind-quiz-api` Edge Function source, and incremental migration `202610030009_expand_question_bank.sql`. Migrations 001–008 are reported by the owner as already applied remotely. The owner confirmed Migration 009 was applied on 4 October 2026; verification returned 366 total questions, 20 categories, 252 Migration 009 rows, and 12 Telugu/Bharati Braille rows. Do not rerun or alter applied migrations 001–009.

The Edge Function performs custom authentication, stores salted PBKDF2 secret-answer hashes, rate-limits attempts, uses opaque expiring sessions, and calls a database function that validates answers and awards XP/coins server-side. Its source in this repository has no `DAILY_BANK_SIZE` or daily-question selection feature. Deployment of the source cannot be inferred from a Git push.

## Known limits

- Achievements, combo rewards, daily question selection, complete quiz counters, and a full profile/progression UI are not implemented as playable features and are not presented as game modes.
- Existing schema tracks XP, coins, level, answer streak, and answer counts. Live Supabase integration was not exercised without an authorized Supabase deployment connection and test account.
- The 252 new questions received a structured editorial review against the category references in `CONTENT_SOURCES.md`; this is not an independent expert review of every item. Changeable facts should be periodically rechecked.
- No genuine recorded audio has yet passed the licensing and clue-matching review, so no audio clue or music asset is shipped.

## Deployment

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` from `main`; the workflow runs `npm test`, builds `dist/`, and deploys it to Pages. It also supports manual dispatch. Supabase Edge Function deployment is separate and is not triggered by the Pages workflow; it requires an authorized Supabase deployment connection.
