# Blind Quiz — architecture and readiness notes

## Repository boundary

This repository contains a static progressive web app, its local question pack, one historical core migration, an incremental Migration 009, and a Supabase Edge Function. Existing Supabase tables and functions remain the backend boundary; no parallel backend or alternate authentication system is introduced.

## Frontend

- Semantic static HTML, CSS, and browser JavaScript with no framework runtime.
- Hash-independent in-page views preserve a logical heading/focus target on navigation.
- Native buttons provide answer semantics and accessible names equal to the answer text.
- Polite and assertive live regions announce relevant state changes; visual feedback also uses text, not color alone.
- Large text, high contrast, reduced motion, configurable timer, keyboard focus styles, and screen-reader-announcement controls are persisted locally.
- A service worker caches the static shell and all question modules for offline rounds.
- Fisher–Yates shuffling independently randomizes question selection and each four-choice answer list. Classic mixed rounds deliberately balance categories; Random Mix samples the full bank. Rapid Fire (8 questions, 15 seconds), Time Attack (10 questions, 10 seconds), and Survival (up to 20 questions, ends on a miss) have distinct selection/scoring behavior.
- Leaving a round cancels its countdown and timer; round tokens prevent stale asynchronous callbacks from changing a later screen. Timed API calls also have a bounded timeout.

## Content

- 825 validated local questions across 25 categories: the 73-question starter pack, 252 applied Migration 009 questions, and 500 prepared Migration 010 questions.
- IDs `bq-en-0001`–`bq-en-0073` preserve the historical starter pack. Migration 009 retains IDs `bq-en-0415`–`bq-en-0666`.
- A live database check before Migration 009 found 114 rows with a highest ID of `bq-en-0414`; Migration 009 was later confirmed applied. Migration 010 adds IDs `bq-en-0667`–`bq-en-1166`, exactly 20 new questions per category. It is prepared but not remotely applied or verified.
- Structural checks enforce unique IDs/prompts/answers, one listed correct answer, explanations, valid difficulties and rewards, HTTPS source notes, and the expected 500-question distribution.
- Content validation regenerates the seed and Migration 010 only; it never rewrites already-applied Migration 009.

## Backend and security

- The browser has only the Supabase URL and publishable key.
- All profile/question tables have RLS and deny direct anonymous/authenticated access.
- The Edge Function implements the requested Name + Login ID + Secret Answer flow with salted PBKDF2 hashes, generic errors, rate limits, opaque sessions, and server-side answer/reward validation.
- Correct answers earn canonical XP/coins once per profile/question. The database function updates XP, coins, level, current/best streak, and answer totals atomically.
- The custom secret-answer credential remains weaker than a password or passkey. Players must not use sensitive or reused answers.
- Deployment is a complete replacement. `supabase functions deploy` bundles the function directory and swaps the deployed version; it never appends to what is already live. A dashboard-edited deployment once served a concatenated ~680-line module that failed with `SyntaxError: Identifier 'createClient' has already been declared` and returned `BOOT_ERROR` for every request.
- `scripts/check-function-source.mjs` gates every deployment: it re-parses `index.ts` as an ES module after type-stripping (a plain `node --check` on a `.ts` file parses as CommonJS and silently misses duplicate ESM imports), rejects duplicate top-level declarations and any second `createClient` or `Deno.serve`, and asserts the PBKDF2/310000, constant-time comparison, hashed-token, rate-limit, origin-allowlist, and no-secret-logging invariants plus the fact that no response payload exposes `answer_hash`, `answer_salt`, `token_hash`, the service key, or the pepper.
- `tests/live-api.mjs` verifies the deployed behaviour over HTTP using only the public publishable key. Secret answers and session tokens are generated in memory and never printed; only status codes and non-sensitive response codes are reported.

## Readiness gaps

- The owner confirmed Migration 009 was applied on 4 October 2026. Post-application verification returned 366 total rows, 252 rows in its ID range, and 12 Telugu/Bharati Braille rows. Migration 010 is prepared as a single 500-row insert migration and still needs content review, one-time application, and post-application verification; this workspace did not deploy it.
- The owner verified the remote question count and maximum ID in the SQL editor. The agent workspace has no Supabase CLI and no outbound route to `*.supabase.co` or `api.supabase.com`, so Edge Function deployment and live auth/reward verification run through `.github/workflows/deploy-function.yml` on GitHub-hosted runners instead of from the workspace. That workflow needs the `SUPABASE_ACCESS_TOKEN` repository secret; `tests/live-api.mjs` can also be run from any machine with network access via `npm run test:live`.
- GitHub Pages is deployed by `.github/workflows/deploy-pages.yml`; the Edge Function is deployed by `.github/workflows/deploy-function.yml`. Neither workflow runs a migration, and the Edge Function workflow asserts that against its own executable lines before deploying.
- Achievements, combo rewards, quiz-completion persistence, daily-bank selection, and a complete profile UI are not implemented.
- Automated checks do not replace manual TalkBack, VoiceOver, keyboard, zoom/reflow, and mobile-device testing.
- No recorded audio has passed license and clue-matching review, so audio clues/music/effects remain absent.
