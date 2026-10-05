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
- [x] **Task 1** - Deploy the website on push (`main` and `arena/**`) instead of on merge (`.github/workflows/deploy-pages.yml`), and confirm the Pages workflow ran and the live site updated.
  - [x] Trigger changed to `push: branches: [main, 'arena/**']` + `workflow_dispatch`; steps unchanged. The workflow runs on every push.
  - [x] Confirmed: Pages run 37267427010 (build + deploy green) from this branch; the live site serves `blind-quiz-shell-v4`, the footer Reload button, one-tap sign in, and 525 questions.
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
- [x] **Final** - Both workflows green on the pull request, live site confirmed updated, `npm run test:live` results reported, this file updated. Then wait for the owner to say "merge".
  - Pages: run 37267427010 green (build + deploy). Live checks: run 37267426982 green - `npm run test:live` **34/34 PASS**; Migration 010 rewards 3/3 PASS (bq-en-0667, 0766, 0866 each award 10 XP and 2 coins).
  - Apply Migration 010: run 37260209884 green (already applied, verified 566 total / 200 rows). Build Android APK: run 37261072243 green, release `android-v1.0.4`.
  - `npm run test:live` cannot run from the sandbox (supabase.co connections are reset), so it runs in the read-only Live checks workflow.
  - **Status: waiting for the owner to say "merge" on PR #5. Do not merge without that instruction.**

## Follow-up request (same session, same PR #5)

Owner decisions: leave `blind-quiz-api` alone (no redeploy; re-confirm with live tests), and add 200 more questions as a new Migration 011 applied the same guarded way.

- [x] **Task 7** - Add 200 more questions: 10 per category across all 20 categories, IDs `bq-en-0867`-`bq-en-1066`, same row format and https sourceNote, no duplicate prompts across all 725. Regenerate `seed.sql`, produce Migration 011 (additive only); Migrations 009 and 010 files must stay byte-identical. Update smoke counts (725 / 652 / `bq-en-1066`).
  - Rows in `MIGRATION_011_ROWS` (`src/expansion-questions.js`), pushed in four batches of 50. `npm run validate:content` writes `supabase/migrations/202610050011_add_200_more_questions.sql`; Migration 009 and 010 files unchanged.
- [x] **Task 8** - Guarded workflow that applies ONLY Migration 011 through the Management API query endpoint using the `SUPABASE_ACCESS_TOKEN` secret (refuses 001-010, never `supabase db push`), verifies 766 total rows, 200 Migration 011 rows, 10 per category; live check that Migration 011 questions award XP and coins.
  - `.github/workflows/apply-migration-011.yml` + `scripts/apply-migration-011.mjs` (refuses any file but 011; preflight requires 252 Migration 009 rows and the 200 Migration 010 rows with fingerprint `e21bc239aeb9427a1816dcb54d7d5486`; local 011 fingerprint `5afc74d183cd824aca546e64d1264ee1`). Live rewards check: `scripts/check-migration-011-live.mjs` in Live checks.
- [x] **Final 2** - Workflows green on PR #5, live site shows 725 questions, `npm run test:live` re-run (function not redeployed), ROADMAP updated, then wait for "merge".
  - Apply Migration 011: run 37268855674 green - applied through the Management API; total 566 -> 766, Migration 009 rows 252, Migration 010 rows 200 (fingerprint unchanged), Migration 011 rows 200 (all active, 10 per category, fingerprint `5afc74d183cd824aca546e64d1264ee1`).
  - Live checks: run 37268855404 green - `npm run test:live` **34/34 PASS** (function not redeployed); Migration 010 rewards 3/3 and Migration 011 rewards 3/3 (bq-en-0867, 0966, 1066 each award 10 XP and 2 coins).
  - Pages: run 37268855421 green; the live site shows 725 playable questions.
  - **Status: waiting for the owner to say "merge" on PR #5. Do not merge without that instruction.**

## Task 9 - Production readiness: security audit, privacy, legal pages, APK (same session, same PR #5)

Owner approvals given during this task: apply an additive privilege-only Migration 012; edit and redeploy `blind-quiz-api` for the rate-limit fixes only; disable unused Supabase Auth signups; delete the unused `smooth-processor` Edge Function.

- [x] **9.1 Audit** - `scripts/security-audit.mjs` + `.github/workflows/security-audit.yml` (read-only; push, weekly, manual). Catalog review through the Management API (RLS, policies, table/column grants, SECURITY DEFINER functions and EXECUTE grants, default privileges, storage, Auth config, Edge Function list, security advisor) plus attacker probes using only the public key (table reads/writes/updates/deletes, RPCs, GraphQL, CORS, forged session, IDOR, unauthenticated answers/reports, Supabase Auth signup, rotating spoofed IPs against login).
  - First run: HIGH `rls_auto_enable()` SECURITY DEFINER executable by anon/authenticated; MEDIUM mutable search_path on `bq_answers_are_unique`; LOW client-executable `bq_answers_are_unique`, default privileges granting future objects to client roles, open Supabase Auth signups, unknown deployed function `smooth-processor`.
  - Function review: login/recover-id/secret-question limits keyed by IP + identity only (spoofable `x-forwarded-for` fallback, no IP-independent ceiling); `submit-report` unlimited; `check-name` keyed per name (unlimited enumeration across names).
  - Frontend review: home page exposed the question count; `console.error` + "question data needs review" debug announcement; failed requests reported as "incorrect credentials"; no CSP; session not re-validated after reload.
- [x] **9.2 Database** - Migration 012 `supabase/migrations/202610050012_privilege_hardening.sql` via `apply-migration-012.yml` (guard allows only REVOKE / ALTER DEFAULT PRIVILEGES / service_role GRANT / pinned search_path; verifies privileges and unchanged row counts). Runs 37271728514 + 37272299909: client EXECUTE revoked on `rls_auto_enable()` and `bq_answers_are_unique`, search_path pinned, postgres default privileges closed. Rows unchanged (766 questions).
- [x] **9.3 Edge Function** - per-account (IP-independent) limits: login 20/h, secret-question 30/h, recover-id 10/day; global ceilings: signup 300/h, check-name 3000/h; check-name per IP (60/h) instead of per name; submit-report 20/day per player and a clean 400 for unknown questions; platform IP headers preferred; expired/revoked sessions of a player deleted at sign-in; `X-Content-Type-Options: nosniff`. Deployed by the PR deploy workflow; live verification 34/34.
- [x] **9.4 Project settings** - `supabase-hardening.yml` (run 37271762828): Supabase Auth `disable_signup=true` (0 Auth users; app unaffected); `smooth-processor` (v3, verify_jwt=true, anonymous probe 401) metadata recorded, deleted, verified 404.
- [x] **9.5 Website** - removed question count and debug output; strict CSP meta (self + Supabase only, no inline code); referrer policy; friendly "Something went wrong. Please try again later." for server/network failures; session kept in sessionStorage only, discarded when locally expired, re-validated with the server after every reload (expired/revoked -> cleared, Sign In shown and announced; offline keeps it); back button returns from sub-views to Home; signup copy corrected (Login ID is recoverable).
- [x] **9.6 Legal** - `privacy-policy.html` and `terms-and-conditions.html` (match the real data flows), linked from Settings ("About and legal") and the footer, 48px targets, honour large-text/high-contrast, cached by `sw.js` (v5), copied by `build.mjs` (build fails if missing or unlinked).
- [x] **9.7 Android** - HTTPS-only allowlist (`classifyNavigation`): the Blind Quiz site stays in the app, other HTTPS links open in the browser, other schemes blocked; WebView debugging off in release, file access off; `usesCleartextTraffic=false`, `allowBackup=false`; Reload keeps web storage (session), reports success/failure via TalkBack-announced SnackBars, never closes the app; WebView stays alive under the offline panel. Workflow audits the signed APK (permissions INTERNET only, not debuggable). Run 37272521204 -> https://github.com/Mahicouragw/Blind-Quiz/releases/tag/android-v1.0.6
- [x] **9.8 Tests** - `tests/smoke.mjs` hardening assertions; `tests/ui-session.mjs` (jsdom, 9 scenarios, gates the Pages deploy); `android-app/test/widget_test.dart` (navigation allowlist, offline panel semantics).
- [x] **9.9 Re-verification** - Security audit run 37272561423: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 1 (platform-owned `supabase_admin` default privileges; existing objects are revoked and RLS deny-all). Live checks run 37272561230 green; Pages run 37272561293 green.
  - **Status: waiting for the owner to say "merge" on PR #5. Do not merge without that instruction.**
