# Blind Quiz roadmap

Permanent record of the October 2026 work session (branch `arena/01a10a16-blind-quiz`,
one pull request). Future sessions should read this file instead of the original prompt.

Ground rules that still apply:

- `blind-quiz-api` is fixed and deployed (`npm run test:live` passes against production). Do not edit or redeploy it as part of content work.
- Migrations 001-009 are applied remotely and must never be recreated, rerun, or pushed. `supabase db push` must not be used (remote migration history does not match the repo).
- Migration 010 is additive only and is applied by its own guarded workflow.

## Tasks

- [x] **Task 0** - Create this ROADMAP.md and keep it up to date.
- [ ] **Task 1** - Deploy the website on push (`main` and `arena/**`) instead of on merge (`.github/workflows/deploy-pages.yml`), and confirm the Pages workflow ran and the live site updated.
  - [x] Trigger changed to `push: branches: [main, 'arena/**']` + `workflow_dispatch`; steps unchanged. The workflow runs on every push.
  - [ ] **Blocked on a repository setting:** the `github-pages` environment only allows the `main` branch to deploy, so the deploy job from `arena/**` is rejected ("Branch ... is not allowed to deploy to github-pages due to environment protection rules"). The session token cannot change environment settings (HTTP 403). Owner fix, once: Settings → Environments → `github-pages` → Deployment branches and tags → Add rule → `arena/**`. Then re-run the latest Pages workflow.
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
- [ ] **Task 5** - Guarded workflow that applies only Migration 010 through the Supabase Management API query endpoint (refuses 001-009, no `supabase db push`) and verifies row counts.
- [ ] **Task 6** - Flutter WebView wrapper for the live URL with a Reload button, plus a GitHub Actions workflow that builds and signs a release APK and publishes it as an artifact and GitHub Release. Keep the PWA installable.
- [ ] **Final** - Both workflows green on the pull request, live site confirmed updated, `npm run test:live` results reported, this file updated. Then wait for the owner to say "merge".
