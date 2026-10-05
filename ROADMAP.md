# Blind Quiz roadmap

Permanent record of the October 2026 work session (branch `arena/01a10a16-blind-quiz`,
one pull request). Future sessions should read this file instead of the original prompt.

Ground rules that still apply:

- `blind-quiz-api` is fixed and deployed (`npm run test:live` passes against production). Do not edit or redeploy it as part of content work.
- Migrations 001-009 are applied remotely and must never be recreated, rerun, or pushed. `supabase db push` must not be used (remote migration history does not match the repo).
- Migration 010 is additive only and is applied by its own guarded workflow.

## Extra workflow added

- `.github/workflows/live-checks.yml` - read-only: runs `npm run test:live` and `scripts/check-migration-010-live.mjs` (3 Migration 010 questions award XP/coins) on every push. Never deploys the function or touches migrations.

## Tasks

- [x] **Task 0** - Create this ROADMAP.md and keep it up to date.
- [ ] **Task 1** - Deploy the website on push (`main` and `arena/**`) instead of on merge (`.github/workflows/deploy-pages.yml`), and confirm the Pages workflow ran and the live site updated.
  - [x] Trigger changed to `push: branches: [main, 'arena/**']` + `workflow_dispatch`; steps unchanged. The workflow runs on every push.
  - [x] Owner added the `arena/**` deployment branch rule to the `github-pages` environment (2026-10-05), so arena session branches can deploy. Before that, GitHub rejected the deploy job ("Branch ... is not allowed to deploy to github-pages due to environment protection rules"); the session token cannot change environment settings (HTTP 403).
- [x] **Task 2** - Restore the lost update work:
  - [x] a) `sw.js` network-first worker (`blind-quiz-shell-v4`, same SHELL list and install/activate handlers, cache fallback only inside `.catch()`, navigations fall back to `./index.html`).
  - [x] b) `index.html` footer Reload button inside `<span class="footer-actions">` with the Log out button.
  - [x] c) `styles.css` footer-actions styles.
  - [x] d) `src/main.js` Reload button listener (announce, then `window.location.reload()`).
  - [x] e) `tests/smoke.mjs` assertions for the reload button, announcement order, CACHE v4, network-first order, and offline fallback.
- [x] **Task 3** - One-tap sign in: remember Name and Login ID on the device after a successful login and prefill them next visit (never store the secret answer); announce the prefilled state.
  - Stored under `localStorage["blindquiz.remembered.v1"]` as `{name, loginId}` only after a successful login; the secret answer is never stored. Prefill is announced, focus jumps to the secret answer, the secret question is looked up, and "Not you? Forget this device" clears it.
- [x] **Task 4** - Add 200 questions (10 in each of the 20 categories, IDs `bq-en-0667`-`bq-en-0866`), wire into `src/content.js`, regenerate `seed.sql`, produce Migration 010, update smoke-test counts (525 / 452 / `bq-en-0866`), and check for duplicate prompts.
  - Rows live in `MIGRATION_010_ROWS` in `src/expansion-questions.js`; `npm run validate:content` regenerates `supabase/seed.sql`, rewrites Migration 009 byte-for-byte unchanged, and writes `supabase/migrations/202610050010_add_200_questions.sql` (200 `insert ... on conflict (id) do nothing` rows, no schema changes).
- [x] **Task 5** - Guarded workflow that applies only Migration 010 through the Supabase Management API query endpoint (refuses 001-009, no `supabase db push`) and verifies row counts.
  - `.github/workflows/apply-migration-010.yml` + `scripts/apply-migration-010.mjs`. Runs on push (main, `arena/**`) when the migration/script/workflow change, or manually. Idempotent: skips when the 200 rows already match (md5 fingerprint of id|correct_answer), refuses on any mismatch.
  - Applied 2026-10-05 by run 37260089609. Verified by run 37260209884: total 366 -> 566, Migration 009 rows 252 (unchanged), Migration 010 rows 200 (all active), 10 in each of 20 categories, fingerprint `e21bc239aeb9427a1816dcb54d7d5486` matches the repository.
- [x] **Task 6** - Flutter WebView wrapper for the live URL with a Reload button, plus a GitHub Actions workflow that builds and signs a release APK and publishes it as an artifact and GitHub Release. Keep the PWA installable.
  - App source: `android-app/` (`lib/main.dart` loads https://mahicouragw.github.io/Blind-Quiz/ with an accessible Reload button that clears the HTTP cache and reloads; back button navigates the WebView; offline screen with Try again).
  - Workflow: `.github/workflows/build-android.yml` (subosito/flutter-action, android-actions/setup-android@v4) generates `android/`, builds `flutter build apk --release`, signs with `apksigner`, uploads an artifact and publishes a GitHub Release `android-v1.0.<run>` (pre-release from `arena/**`, full release from `main`). First green build: run 37261072243 -> https://github.com/Mahicouragw/Blind-Quiz/releases/tag/android-v1.0.4
  - Signing uses `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` when set; until then each build uses a temporary key (see `android-app/README.md`). Optional owner step: add those secrets for in-place APK updates.
  - PWA unchanged and still installable (manifest + service worker asserted in `tests/smoke.mjs`).
- [ ] **Final** - Both workflows green on the pull request, live site confirmed updated, `npm run test:live` results reported, this file updated. Then wait for the owner to say "merge".
