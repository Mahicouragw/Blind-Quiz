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
- [ ] **Task 2** - Restore the lost update work:
  - [ ] a) `sw.js` network-first worker (`blind-quiz-shell-v4`, same SHELL list and install/activate handlers, cache fallback only inside `.catch()`, navigations fall back to `./index.html`).
  - [ ] b) `index.html` footer Reload button inside `<span class="footer-actions">` with the Log out button.
  - [ ] c) `styles.css` footer-actions styles.
  - [ ] d) `src/main.js` Reload button listener (announce, then `window.location.reload()`).
  - [ ] e) `tests/smoke.mjs` assertions for the reload button, announcement order, CACHE v4, network-first order, and offline fallback.
- [ ] **Task 3** - One-tap sign in: remember Name and Login ID on the device after a successful login and prefill them next visit (never store the secret answer); announce the prefilled state.
- [ ] **Task 4** - Add 200 questions (10 in each of the 20 categories, IDs `bq-en-0667`-`bq-en-0866`), wire into `src/content.js`, regenerate `seed.sql`, produce Migration 010, update smoke-test counts (525 / 452 / `bq-en-0866`), and check for duplicate prompts.
- [ ] **Task 5** - Guarded workflow that applies only Migration 010 through the Supabase Management API query endpoint (refuses 001-009, no `supabase db push`) and verifies row counts.
- [ ] **Task 6** - Flutter WebView wrapper for the live URL with a Reload button, plus a GitHub Actions workflow that builds and signs a release APK and publishes it as an artifact and GitHub Release. Keep the PWA installable.
- [ ] **Final** - Both workflows green on the pull request, live site confirmed updated, `npm run test:live` results reported, this file updated. Then wait for the owner to say "merge".
