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

Node.js 22.13 or newer is recommended; the Edge Function integrity guard uses Node's TypeScript type-stripping API and degrades gracefully on older versions.

```sh
npm test                 # content, accessibility, schema, and Edge Function source guards
npm run test:a11y        # content and accessibility checks only
npm run test:function    # Edge Function source integrity only
npm run test:live        # verify the DEPLOYED function end to end (needs network)
npm run validate:content
npm run build
python3 -m http.server 4173
```

`npm run validate:content` validates the bank, regenerates `supabase/seed.sql`, and regenerates the prepared incremental Migration 009. `npm run build` creates the static production output in the ignored `dist/` directory.

`npm run test:live` exercises the deployed Edge Function with the public publishable key only. It creates a throwaway verification identity per run, and never prints secret answers, session tokens, apikeys, or Authorization headers — only HTTP status codes and non-sensitive response codes.

Automated accessibility checks are source-level checks, not a substitute for manual TalkBack, VoiceOver, keyboard, zoom, and contrast testing on target devices.

## Supabase

The browser contains only the public project URL and publishable key in `src/config.js`. Never add a service-role key, database password, Supabase access token, or rate-limit pepper to client code or Git.

The repository snapshot includes the historical core migration `202609260001_core.sql`, seed output, the `blind-quiz-api` Edge Function source, and incremental migration `202610030009_expand_question_bank.sql`. Migrations 001–008 are reported by the owner as already applied remotely. The owner confirmed Migration 009 was applied on 4 October 2026; verification returned 366 total questions, 20 categories, 252 Migration 009 rows, and 12 Telugu/Bharati Braille rows. Do not rerun or alter applied migrations 001–009.

The Edge Function performs custom authentication, stores salted PBKDF2 secret-answer hashes, rate-limits attempts, uses opaque expiring sessions, and calls a database function that validates answers and awards XP/coins server-side. Its source in this repository has no `DAILY_BANK_SIZE` or daily-question selection feature. Deployment of the source cannot be inferred from a Git push.

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

**Preferred — no editor at all.** Store a Supabase personal access token as the `SUPABASE_ACCESS_TOKEN` repository secret (GitHub → Settings → Secrets and variables → Actions). It is two ordinary text fields. Any push to `supabase/functions/**`, or a re-run of the workflow, then deploys from the repository source and runs the live verification automatically. The token stays inside GitHub and is never printed.

**Dashboard — paste over, never delete.** Copy the file with the *Copy raw file* button on its GitHub file page, then in the dashboard editor focus the code, choose **Select all** from the long-press (or TalkBack local) menu, and **Paste** without moving focus. Pasting onto a selection replaces it, so the old content is discarded in one action. Verify with Chrome's *Find in page*: `import { createClient }` must report **1 of 1**. If it reports 1 of 2, the module is still duplicated.

If the editor does not expose its full text to a screen reader, delete the function and recreate it with the same slug `blind-quiz-api` so the editor starts empty — then **turn JWT verification off** to match `verify_jwt = false` in `supabase/config.toml`. The app sends the publishable key plus its own opaque session token, not a Supabase JWT, so leaving JWT verification enabled makes the platform reject every request with a 401 before the handler runs.

## Known limits

- Achievements, combo rewards, daily question selection, complete quiz counters, and a full profile/progression UI are not implemented as playable features and are not presented as game modes.
- Existing schema tracks XP, coins, level, answer streak, and answer counts. `npm run test:live` exercises the deployed function directly; it requires outbound network access to the project and cannot run in a sandbox that blocks `*.supabase.co`.
- The 252 new questions received a structured editorial review against the category references in `CONTENT_SOURCES.md`; this is not an independent expert review of every item. Changeable facts should be periodically rechecked.
- No genuine recorded audio has yet passed the licensing and clue-matching review, so no audio clue or music asset is shipped.

## Deployment

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` from `main`; the workflow runs `npm test`, builds `dist/`, and deploys it to Pages. It also supports manual dispatch.

Supabase Edge Function deployment is handled separately by `.github/workflows/deploy-function.yml`, which runs the source integrity guard, deploys `blind-quiz-api` as one complete replacement, and then runs `tests/live-api.mjs` against the live function. It triggers on changes to `supabase/functions/**`, the deploy tooling, or the workflow itself, and supports manual dispatch. It requires the `SUPABASE_ACCESS_TOKEN` repository secret; the verification job needs no secret because it uses only the public publishable key.

`tests/live-api.mjs` verifies, against the deployed function: boot without `BOOT_ERROR`; signup with Name + Secret Question + Secret Answer; that an eight-character Login ID from the unambiguous server alphabet is returned; login with Name + Login ID + Secret Answer; Login ID recovery; logout and session revocation; server-validated answer rewards including rejection of a client-chosen wrong answer and of reward replay; generic client errors that do not distinguish an unknown name from a wrong answer; and rate limiting.
