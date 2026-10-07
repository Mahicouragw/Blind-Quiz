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
- [x] **9.7 Android** - HTTPS-only allowlist (`classifyNavigation`): the Blind Quiz site stays in the app, other HTTPS links open in the browser, other schemes blocked; WebView debugging off in release, file access off; `usesCleartextTraffic=false`, `allowBackup=false`; Reload keeps web storage (session), reports success/failure via TalkBack-announced SnackBars, never closes the app; WebView stays alive under the offline panel. Workflow audits the signed APK (permissions INTERNET only, not debuggable). Run 37272521204 (android-v1.0.6); latest run 37272937372 -> https://github.com/Mahicouragw/Blind-Quiz/releases/tag/android-v1.0.7
- [x] **9.8 Tests** - `tests/smoke.mjs` hardening assertions; `tests/ui-session.mjs` (jsdom, 9 scenarios, gates the Pages deploy); `android-app/test/widget_test.dart` (navigation allowlist, offline panel semantics).
- [x] **9.9 Re-verification** - Security audit run 37272561423: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 1 (platform-owned `supabase_admin` default privileges; existing objects are revoked and RLS deny-all). Live checks run 37272561230 green; Pages run 37272561293 green.
  - **Status: waiting for the owner to say "merge" on PR #5. Do not merge without that instruction.**

## Task 10 - Bug hunt, recorded sound and music (same session, same PR #5)

- [x] **Critical bug: every game froze on "Get ready!"**. The countdown still called a removed `tone()` function, which threw, so no question ever appeared, and the `locked` flag stayed set, so after that **no other game or category would open** (the reported "Business not starting" and "pressing another game does nothing"). Fixed by replacing the calls with recorded sounds and making the countdown cancellable with a round token (`finally` always releases the lock).
- [x] Leaving a round now cancels its countdown and timer (a running timer used to fire in the background). The game stage (`#game-copy`, title style, answers, feedback) is reset for every new round; it used to be left half-removed.
- [x] Sign-in confusion: the profile screen was never reachable and the home button kept saying "Sign in or create account" after login, with only "goldfish · Login ID account" at the top. Now the top shows "Signed in as goldfish", the home button says "Your profile: goldfish" and opens a profile with level, XP, coins, streaks and accuracy, plus Log out.
- [x] Recorded audio: `scripts/audio/commons-audio.mjs` + `audio-assets.yml`. It downloads pinned Wikimedia Commons recordings, re-verifies CC0/Public domain through the API, trims and normalises them with ffmpeg, and commits `assets/audio/*.mp3` + `manifest.json`. That's 13 files, about 4.7 MB. `src/audio.js` plays them with HTML audio elements (no Web Audio, no synthesis): bell (correct), buzzer (wrong), watch ticks + referee whistle (countdown), school bell (time up), applause / cheering (results), and music per screen and category group. Settings: Sound effects, Background music, Music volume. Music starts after the first tap, pauses in the background, and if a file is missing the game stays silent instead of failing.
- [x] Tests: `tests/ui-session.mjs` now plays all 20 categories and 6 modes to the results screen. It also covers leaving mid-countdown and mid-timer, Play again, Surprise me, Braille, the signed-in profile, and which recorded sound plays for each event. `tests/smoke.mjs` checks the audio licences and files.

## Task 11 - TalkBack, profile Change, Letters to Words (same session, same PR #5)

- [x] **TalkBack bug, "Sign in…" read after answering:**
  - Cause 1: every saved answer refreshed the header "Signed in as …", which was an `aria-live` region.
  - Cause 2: the answer buttons were `disabled`, which dropped TalkBack focus.
  - Fix: the header is not live and only changes when its text changes. Answer buttons use `aria-disabled`. Focus moves to the result (verdict, correct answer, XP, coins, streak, explanation), followed by Next question. Hidden views are `hidden` + `inert` + `aria-hidden`.
- [x] **Profile semantics:** a plain list read as "Player, goldfish", "Level, 1", … "Correct answers, 9, 90 percent". The User ID is spoken letter by letter. There is no definition list any more.
- [x] **Profile Change:**
  - The User ID is read-only.
  - Username, secret question and secret answer can be changed. The current secret answer is required (owner decision).
  - Cooldown of 7/14/30/60 days, stored in the database: `name_change_count` and `name_changed_at`, enforced by `bq_change_name` under a row lock.
  - Uniqueness is enforced by the existing UNIQUE `name_normalized` (case-insensitive, race-safe).
  - The secret answer is re-hashed with a new salt, and other sessions are revoked.
  - The profile refreshes immediately. Progress stays on the same profile id.
- [x] **Letters to Words:** new game with a SCOWL dictionary of 17,461 words in 3 tiers, an offensive-word blocklist, 7 levels (4→7 letters) and generated puzzles that are always solvable. XP and coins are checked by the server: `record-word` checks the letters, and `bq_record_word` checks the dictionary and pays only on the first find.
- [x] **Migration 013** (owner-approved, additive), applied by `apply-migration-013.yml` with static guards and verification. Migrations 001–012 are pinned by SHA-256 in `tests/smoke.mjs`.
- [x] **blind-quiz-api** (owner-approved): new `update-profile` and `record-word` actions. The profile also returns the User ID, your own secret question and the cooldown. Live API checks: 47/47 (34 previous + 13 new).
- [x] **QA:** jsdom scenarios 13–15 (TalkBack focus, profile Change, Letters to Words). The smoke test generates 60 puzzles per level and checks they are all solvable.

## Task 12 - Bug hunt: A/B/C/D options and repeated "Question 1 of 10" (same session, same PR #5)

- [x] **TalkBack repeated "Question 1 of 10" on every option:** a regression from Task 11, where each answer button was `aria-describedby` the progress line. Removed. The progress is now spoken once, in the question heading ("Question 1 of 10. …"), and the small progress label is hidden from screen readers.
- [x] **Options are labelled A, B, C, D:** visible letter badges, and TalkBack reads "Option B: Paris". Results name the letter ("You chose A: … The correct answer is B: …"). "Hear question and options again" reads every option. Keyboard players can press A–D.
- [x] **Mode buttons** are named "Vocabulary mode. …" so they are no longer confused with the category of the same name.
- [x] **Content check:** all 725 questions have exactly 4 unique options that include the correct answer; there are no duplicates and no "all of the above". A jsdom accessibility sweep over every screen found no duplicate IDs, broken ARIA references, unnamed buttons, unlabelled fields, or focusable elements inside aria-hidden. Test 16 added. Service worker cache v9.

## Task 13 - Letters to Words: duplicate letters and two-letter words (same session, same PR #5)

- [x] **"TOO" could not be made from F T O O:** TalkBack keeps focus on the pressed tile, so pressing O again hit the same tile and removed it. Now a second press uses the other unused O. If there is no other copy, the game says so. Pressing a letter never removes it; only "Remove last letter" and Clear do.
- [x] **Two-letter words count:** 32 curated common words (of, to, go, in, …) in `src/short-words.js`, recognised automatically from two letters. Migration 014 (approved, additive, applied by its own guarded workflow) widens the `bq_words` length check to 2–7, seeds the words, and pays 1 XP + 1 coin for a two-letter word the first time. `record-word` accepts 2–7 letters (approved). Smoke, live-API and jsdom tests extended. Service worker cache v10.

## Task 14 - Automatic level-up with a real level-up sound (same session, same PR #5)

- [x] **Letters to Words rounds and level XP:** each puzzle is a round. Found words earn level XP (same scale as the server: 1-6 by length) plus a round bonus. When the level's target is reached (30 / 50 / 75 / 100 / 125 / 150 XP) the game levels up by itself, about 4-5 rounds per level; no button is needed. Seven named levels (Beginner, Easy plus, Intermediate, Intermediate plus, Advanced, Expert, Master) grow from 4 to 7 letters, rarer words and bigger goals. Level, level XP and round are saved on the device, and a visible XP bar shows progress.
- [x] **Level-up sequence:** the round-complete sound (applause) plays, then a recorded bugle call (U.S. Marine Band "Band Call", public domain). One announcement, focused for TalkBack: "Round complete! 3 words found. 12 level XP earned… Level up! You are now Level 2, Easy plus. Now: 5 letters… Next: Round 1. Your letters are …". The next, harder puzzle is already on screen.
- [x] **Profile level-ups in every game:** the server raises the profile level every 100 XP. The quiz and Letters to Words now detect it, play the coin and level-up sounds, and say "Level up! You reached Level N." Quiz results also say the XP and coins earned in the round.
- [x] **Audio:** new recorded `levelup` and `coin` effects (Wikimedia Commons, public domain, encoded by the audio workflow). `playSequence` plays effects one after another and lowers the music while they play, so sounds never pile up.
- [x] **Tests:** smoke checks for the level design, XP scale and sounds. jsdom scenario 17 checks the automatic level-up (applause, then the bugle, announcement, 5-letter level, focus). Scenario 15 checks the round result. Service worker cache v11.

## Task 15 - Five new categories, Mixkit/Pixabay audio, sighted-player visuals (same session, same PR #5)

Owner decisions: Mixkit sound effects plus Pixabay music (human-made tracks only; Mixkit music is not licensed for games); Migration 015 approved.

- [x] **15.1 Five new categories:** Medical, Math, Physics, Chemistry, Biology with 20 questions each (`bq-en-1067`-`bq-en-1166`, `MIGRATION_015_ROWS`). No repeated prompts or repeated facts across all 825 questions; 4 unique options with one correct answer. Migration 015 (insert-only, `on conflict (id) do nothing`) is applied by `apply-migration-015.yml` (preflight requires Migration 011 with its fingerprint; verifies 20 rows in each of the 5 categories). Live check `scripts/check-migration-015-live.mjs` confirms they award XP and coins. Migration 014 is now pinned by SHA-256 too.
- [x] **15.2 Stock audio:** all 10 sound effects now come from Mixkit (Sound Effects Free License, games allowed, no attribution), pinned by asset id in `scripts/audio/sources.json`. They are downloaded as full WAVs by `scripts/audio/stock-audio.mjs` (workflow `audio-assets.yml`), then trimmed, normalised and encoded. Music comes from Pixabay (Content License, human artists only). Pixabay blocks automated downloads (HTTP 403 for GitHub runners) and its FAQ requires downloading from pixabay.com, so the owner downloads tracks by hand and uploads `assets/audio/incoming/<slot>-<file>.mp3`. The workflow encodes them, deletes the originals (never published), regenerates `manifest.json` + `AUDIO_LICENSES.md`, and redeploys Pages. Slots without an upload keep their Commons CC0/PD recording. Audio URLs carry `?v=<bytes>` so replaced files are never served stale; service worker v12. Mixkit music is not used.
- [x] **15.3 Visuals for sighted players** (all decorative and `aria-hidden`, so screen-reader output is unchanged):
  - category cards get an icon and colour tint; names stay the only text, as before
  - quiz HUD shows a visible countdown ring with seconds (turns coral at 5 s and pulses) and a live score
  - big animated 3-2-1 countdown; answers mark ✓/✗ with pop/shake animations and a coloured feedback banner
  - results show 0–3 stars
  - Letters to Words shows word slots, numbers the pick order on tiles, adds goal pips and found-word chips
  - home shows the current category count (25) and "Tap, click, keys A–D or screen reader"
  - all animations are disabled by Reduce motion and `prefers-reduced-motion`
- [x] **15.4 OpenGameArt music:** all 5 music slots now use CC0 tracks by human composers from OpenGameArt.org, pinned by page and file in `scripts/audio/sources.json`: menu "The Field Of Dreams" (pauliuw), game1 "Town Theme RPG" (cynicmusic), game2 "Crystal Cave" (cynicmusic), game3 "Feel Good Island" (HaelDB), results "Children's March Theme" (CleytonKauffman). `stock-audio.mjs` reads each live page on every build and fails unless CC0 is listed. A hand-uploaded Pixabay track for a slot still takes priority.

## Task 16 - Simple level-ups, 20 levels, simpler sign-in, game identity, APK with QR (same session, PR #5)

- [x] **16.1 Level-ups:** every game now says only "Level up! You are now Level N." Letters to Words announces its own level only; profile level changes are no longer announced inside it (they still show on the Profile page). The quiz says "Level up! You are now Level N." for the player level.
- [x] **16.2 20 Letters to Words levels** (was 7). Levels 1-7 are unchanged except that Master now has an XP target. Levels 8-20 (Word Hunter, Sharp Ear, Wordsmith, Puzzler, Lexicon, Champion, Virtuoso, Sage, Legend, Mythic, Titan, Grandmaster, Word Wizard) get harder in these ways:
  - word goals rise from 9 to 16
  - rarer letter sets
  - 1-3 required long words (5+ letters)
  - fewer hints per round (5 down to none)
  - no time limit, so screen-reader play stays comfortable

  Puzzles are only chosen when the long-word goal is achievable.
- [x] **16.3 Sign-in/sign-up text:** removed "No email, password, phone, or OTP…" and the long secret-answer warning. The intro now reads "Log in with your name, Login ID and secret answer." (sign-up: "Create an account with your name, a secret question and a secret answer.").
- [x] **16.4 Android app 1.2** (`build-android.yml`):
  - new Blind Quiz launcher icon: a braille "?" cell with sound waves
  - Share button (QR icon) opening a panel with the website QR code and "Copy website link" / "Copy app download link"
  - the Reload button stays
  - it still loads the live site, so players never need to update or reinstall

  Every build is published as the **latest** release with a fixed-name `blind-quiz.apk`, then the Pages deploy mirrors it. Permanent links:
  - https://mahicouragw.github.io/Blind-Quiz/download/blind-quiz.apk
  - https://github.com/Mahicouragw/Blind-Quiz/releases/latest/download/blind-quiz.apk

  Service worker v13 never caches `/download/`.
- [x] **16.5 Own game identity, "Night Arcade":**
  - a grape night stage with a braille-dot texture
  - chunky arcade-key buttons that press down
  - colour-coded A–D answer keys
  - cream board-game letter tiles
  - marigold/mint/coral palette, all text at 7:1 contrast or better
  - self-hosted SIL OFL fonts: Atkinson Hyperlegible (Braille Institute, for low vision) for reading, Bungee for titles
  - braille-cell logo, new icon, rewritten home copy ("Hear it. Tap it. Win it.")
  - "Get the Android app" section with app and website QR codes, hidden inside the app

  High contrast, large text and reduced motion still override everything.
- [x] **16.6 Home music playlist.** Home, sign-in, settings and profile now rotate five CC0 OpenGameArt tracks, replacing The Field of Dreams:
  - Fantasy Orchestral Theme (Joth, epic cinematic)
  - Happy Adventure (TinyWorlds)
  - Medieval: The Bard's Tale (RandomMind, relaxing)
  - Battle Theme A (cynicmusic, epic)
  - Happy Lullaby (cynicmusic)

  Any slot can be a playlist (`music_menu`, `music_menu2`…). Each visit starts on the next track, and the next track fades in when one ends. Licences are checked by the bot (CC0 only).
- [x] **16.7 Word meanings and cleaner word messages (Letters to Words).**
  - Every found word is followed by its meaning, spoken in the message and shown on a meaning card. Example: "Word found: SEE. Meaning: to perceive by sight. 1 of 4 found."
  - Meanings cover 17,253 of 17,493 answer words (Princeton WordNet 3.1, bundled, offline).
  - A word found in an earlier game still counts, without the "earlier game … no new profile XP" sentence.
  - The round summary says "You earned N XP and N coins this round."
  - Service worker v14.

## Task 17: Settings-only legal links, contact, feedback, more questions, Sound Match
- [x] **17.1 Legal links and contact.**
  - Privacy Policy and Terms and Conditions links were removed from the footer that shows during play. They remain in Settings > About and legal.
  - Settings has a new **Contact us** section with numbersareplaying@gmail.com, as an email link plus a Copy email address button (older app versions block email links). The legal pages list the same address.
  - Android app: opens exactly that mailto: address in the user's email app (SENDTO query); all other mailto: links stay blocked.
- [x] **17.2 Migration 016: 250 more questions and the new word reward.** 10 new questions in each of the 25 categories (`bq-en-1167`–`bq-en-1416`, `src/questions-016.js`). They were checked against all 825 existing questions so that no prompt or fact repeats (for example, the India highest-peak question asks for the highest peak entirely within India: Nanda Devi). The new Braille questions cover UEB contractions, punctuation and history.
  - Letters to Words now pays **5 XP and 1 coin the first time a player finds a word**, whatever its length; repeats score round points only. This is a `create or replace` of `bq_record_word` in the same migration, still service-role only.
  - Applied only by `.github/workflows/apply-migration-016.yml`, using guards like 015's. It refuses unless 015 is live with its fingerprint, compares the function block with `scripts/migration-016-function.sql`, and afterwards verifies 25×10 rows and the 5 XP rule. Migrations 001–015 are byte-identical.
  - Category cards now show a short description under the name. Offline cache v15.
- [x] **17.3 Feedback form and the Goldfish feedback inbox (Migration 017).** Players open Settings, then Send feedback. They must be signed in. The name they type is checked against their own account in the browser and again on the server (`name_mismatch`), so nobody can send feedback under someone else's name.
  - The player chooses General feedback, Report a problem, or Idea or suggestion. For a problem report, the game asks for a screenshot. The browser shrinks it to a JPEG of at most about 850 KB; the server accepts only image data URLs. Sending is limited to 8 per day per account.
  - Feedback goes to the `bq_feedback` table. The only admin is the account listed in `bq_admins`, which is the Goldfish account. Goldfish sees a Feedback inbox section in Settings, showing the number of new messages, which opens the inbox view. Opening a message shows its screenshot and marks it read. Everyone else is refused (`forbidden`).
  - Both tables have row level security on and are reachable only through the Edge Function. Migration 017 is additive and is applied by `.github/workflows/apply-migration-017.yml` with exact-statement guards.
  - Android: the app now opens the system photo picker for the screenshot field (`image_picker`, no storage permission). Older APKs can still send feedback without a screenshot.
  - Live checks exercise only the refusal paths, so they never put test messages in the inbox. jsdom test 18 covers the whole flow.
- [x] **17.4 Sound Match (a memory game played by ear).** Home → Sound Match. Every number hides a recorded sound, and each sound sits behind exactly two numbers. Press a number to hear it, then find the other number with the same sound.
  - Levels: Easy shows numbers 1–10 (5 pairs), Medium 1–16 (8 pairs), Hard 1–20 (10 pairs). Each board mixes the moods.
  - A match plays the correct sound, names the sound on both buttons, and is spoken ("Match! 3 and 7 are both Lion roar."). A miss plays the wrong sound and closes both numbers. Found numbers can be replayed.
  - At the end the game shows stars (perfect memory = 3) and the best score per level, saved on the device. Background music stops on this screen so the clues are clear. Clips play even when sound effects are off, because they are the game.
  - **32 recorded Mixkit clips** (Sound Effects Free License, games allowed): 8 funny, 8 mysterious, 8 cinematic and 8 interesting. They are pinned by id in `scripts/audio/sources.json`, encoded by `audio-assets.yml` to `assets/audio/match_*.mp3` (700 KB total) and listed in `AUDIO_LICENSES.md`. Ids were chosen from the read-only `mixkit-catalog.yml` listing.
  - Pixabay and Freesound were not used: Pixabay allows only manual downloads, and Freesound needs an account. No XP is awarded yet; paying XP would need a server change.
  - Tests: logic in smoke; full Easy game, Medium and Hard in jsdom test 19.
- [x] **17.5 Sound Match XP and coins (Migration 018, approved).** Signed-in players earn Easy 5 XP + 1 coin, Medium 10 XP + 2 coins, Hard 15 XP + 3 coins, with XP doubled for 3 stars. The finish message says "You earned N XP and N coins", plus the usual "Level up! You are now Level N."
  - Server-checked: `soundmatch-start` registers the board, and `soundmatch-finish` pays once per game.
  - The finish is refused if it is faster than 1.5 s per pair, if the number of tries is impossible, or if the game is older than 3 hours. Stars are computed on the server, and payouts stop after 40 paid games in 24 hours.
  - `bq_sound_match_games` has row level security; both functions are service_role only. The migration was pushed and applied before the API change, so the live checks never ran against a missing migration.

## Task 19: Multiplayer and social (owner request, 6 Oct 2026)
Built in stages, each pushed and verified live: **A** notifications and feedback replies, **B** online players, player cards and friends, **C** end-to-end encrypted private messages between friends, **D** rooms with live games and spectators, **E** exit confirmation, **F** device notifications on Android.
- [x] **19.1 Migration 019** (additive, applied by `.github/workflows/apply-migration-019.yml`).
  - New columns: `last_seen_at` and `notifications_enabled` on `bq_profiles`; `reply` and `replied_at` on `bq_feedback`.
  - New tables with row level security, service_role only: `bq_notifications` and `bq_friendships`. Fourteen functions, all callable only by service_role.
  - New shared guard `scripts/lib/guarded-migration.mjs`:
    - Only additive statement shapes on declared tables and functions.
    - No DDL or dynamic SQL inside function bodies.
    - Function bodies may not change credentials.
    - Before and after each apply it checks the locks and the row counts.
  - New `tests/db-migrations.mjs` runs **every migration from 001 to 019 in an in-memory Postgres (PGlite)**, then 21 behavioural checks, before anything touches the live database.
- [x] **19.2 Notifications.**
  - A Notifications button in the top bar shows the unread count. A presence heartbeat runs every 20 seconds while the app is open (60 seconds in the background).
  - Kinds: friend request (with Accept and Reject), friend accepted, feedback reply, announcement. Kinds for messages and room or match invites are reserved for later stages.
  - New notifications play a recorded Mixkit chime (id 253) and are announced, but never during a running game.
  - Settings has a Notifications switch, plus an optional "Also show them on this device" button (browser Notification API, shown while the game is open in the background).
- [x] **19.3 Feedback replies.**
  - In the Goldfish inbox, every item has a reply box. The player gets a notification.
  - Settings > My feedback shows each message as "Sent, not read yet", "Read by the developer" or "Replied", with the reply text.
  - Goldfish can also send an announcement to every player, for example "A new game was added".
- [x] **19.4 Multiplayer tab, player cards, friends.**
  - Home > Multiplayer has two tabs: Online (players seen in the last 2 minutes) and Friends (requests for you, your friends, requests you sent). A player can also be found by name.
  - A player card shows level, XP, coins, questions answered and correct (with percent), quizzes, best streak, words found, Sound Match games, "playing since" and 10 achievements earned from those stats.
  - **A card never contains the Login ID, the secret question or any hash.** This is checked in SQL, in smoke, in jsdom and in the live API.
  - A match needs friendship first. If the players are not friends, the card says so and offers "Add friend: send a friend request". The other player sees "X sent you a friend request" with Accept and Reject.
  - A request sent back to someone who already asked you accepts their request. At most 50 requests can be waiting at once.
- [x] **19.5 End-to-end encrypted private messages between friends (Migration 020).** Friends can open a chat from a player card, from the Friends list, or from a message notification. Messages are encrypted on the device before sending, with WebCrypto and no libraries.
  - Each device makes its own ECDH P-256 key pair. The private key is non-extractable and kept in IndexedDB; only the public key goes to the server. Up to 4 devices per account are active.
  - Each message is sealed separately for every active device of both friends, using ECDH, then HKDF-SHA-256 with a random salt, then AES-256-GCM. The sender and recipient device IDs are bound into the key derivation and the authenticated data.
  - **The server stores only public keys and ciphertext.** The messages table has no text column. The API accepts only sealed boxes and refuses plain text. The apply workflow checks that there is no plaintext column.
  - Tampering is detected: a changed message fails AES-GCM verification and is hidden with "could not be verified", never shown altered.
  - The chat shows a 30-digit safety code for friends to compare, and a "Read the safety code slowly" button. Keys are pinned on first use, both the friend's and your own other devices. A new or changed key shows a warning, and nothing can be sent until the player confirms.
  - Honest limit: a new device cannot read messages that arrived before it was set up; the chat says so. Only friends can message, and new messages notify the friend once per sender.
  - Tests:
    - PGlite: 15 database checks.
    - Smoke: real WebCrypto seal and open; rejection of tampering, a swapped key and the wrong device; the safety code; key pinning.
    - jsdom test 21: the full chat against a relay that sees only ciphertext.
    - Live API: 4 checks with two accounts.
  - Offline cache v19.
- [x] **19.6 Exit confirmation (stage E).** Leaving a quiz, Letters to Words or Sound Match, and rooms once they exist, first asks "Are you sure you want to exit?". It uses an accessible alert dialog, and focus starts on "No, keep playing". Escape also stays.
  - This covers back buttons, the logo and the Android or browser Back button. Finishing a round never asks.
  - Tests: jsdom tests 10 and 15 (Stay and Exit), plus a smoke check.
- [x] **19.7 Rooms (stage D, Migration 021).** Multiplayer has a Rooms tab. Three public rooms are always there: Blind Quiz, Word Lovers and Sound Lounge. The list shows each room's name, number of games and number of players inside.
  - Anyone can make rooms of their own, public or private, with no limit on how many (Migration 022; at most 10 new rooms an hour against spam, and rooms nobody has entered for 30 days are removed; the three default rooms always stay). Private rooms are hidden and open only to the owner and friends they invite. Invitations arrive as notifications that open the room.
  - Inside a room: who is there, room chat, the game list (Join and play, Watch) and Create a game: Quiz (any category and mode), Letters to Words, or Sound Match (Easy, Medium, Hard). Up to six players per game.
  - Watching live: each player's game sends what it announces (questions with options, verdicts, Letters and Sound Match messages), its recorded sound effects, Sound Match sounds and the score. Spectators hear them through their own speech and sound settings, read a live log and scoreboard, and can comment.
  - Send a match (friends only) opens a private two-player room and sends a game invite notification.
  - Leaving a room asks first; starting or watching a game in the room does not. Leaving a room game ends it for spectators.
  - Tests: PGlite dry run, a smoke block, jsdom test 22 and 5 new live API checks. Offline cache v20.
- [x] **19.8 Voice messages in rooms, and calls and files between friends (Migration 023).** Owner decisions: no calls in rooms; free services only.
  - Rooms: record a voice message of up to 60 seconds and press Stop and send; anyone in the room can play it. Voice messages are deleted after 24 hours.
  - Friend chat: Audio call, Video call and Send a file. These need **both friends online**, with no size cap below 2 GB (well over 6 MB). Calls and files go directly between the devices (WebRTC, encrypted) and are never stored. Only small setup messages pass through the server; they are sealed end to end with the device keys from Migration 020 and deleted within 10 minutes.
  - The flow is ring, then accept, then connect. There is an accessible incoming dialog (Accept or Decline), spoken progress every 25 percent, and Mute, Camera and Hang up during calls. Hang-up travels over the call connection, so it is instant.
  - Free STUN only, with no paid relay, so a few strict mobile networks may fail to connect; the app says so clearly. The heartbeat is every 10 seconds while visible, so calls ring quickly.
  - Tests: PGlite (signals friends-only, online-only, sealed for the friend's devices, 10-minute expiry; voice 60 s, audio only, 24-hour expiry), smoke (sealed signals open; forged, cross-use and replay rejected), jsdom test 23 (two players: file transfer with confirmation, video call, mute, hang up, decline; the relay never sees file names) and 2 new live API checks. Offline cache v21. Privacy Policy updated.
- API: social actions go through one table in `blind-quiz-api`. Each row is a database function, an argument check and a per-account hourly limit; admin-only rows are checked against `bq_admins`. Other players are addressed by display name only.
- Tests: smoke (Task 19 block), jsdom test 20 (plus admin reply and announcement in test 18), and 7 new live API checks run with two real accounts. Offline cache v18.
- [x] **19.9 Device notifications on Android (stage F, owner request: "Android notification with push no Firebase").**
  - Friend requests, developer replies, announcements and game invites appear as real Android notifications while Blind Quiz runs in the background. **No Firebase project, no push service, no third party:** delivery is the polling heartbeat that already drives the bell (10 s in the foreground, 60 s in the background), so nothing about the player leaves the existing Supabase project.
  - The Android WebView has no browser Notification API, so the Flutter wrapper injects `window.BQNotifications` and `android-app/native/MainActivity.kt` shows the notification over a `blind_quiz/notifications` method channel (`state`, `request`, `post`, `clear`). The permission answer returns on `window.bqDeviceNotificationPermission`; tapping a notification (or cold-starting the app from the tray) opens the in-app notifications list through `window.bqNotificationOpened`, once the page has loaded.
  - Settings keeps the same button; inside the app it reads "Also show them as Android notifications". Android 13+ asks for `POST_NOTIFICATIONS` the first time; the manifest asks for it and the build workflow's APK audit allowlists exactly it. Turning the setting off clears the tray. A hint under the button says where notifications appear.
  - A background alert shows the notification's own words ("Bob sent you a friend request.") instead of only a count — one extra API call, and only when the player turned notifications on and the game is in the background. Foreground alerts never post (bell, chime and speech already told the player). Opening the app or the notifications list clears the tray. In a normal browser the existing Notification API path still works, unchanged.
  - Tests: a smoke block (bridge operations, background-only rule, no push service or socket, manifest permission and audit allowlist), jsdom scenario 24 (ask Android once, grant, background alert with the notification's own words, foreground silence, tap-through, off), and Dart tests for the channel name and clean single-line tray text. Offline cache v22. No database, migration or Edge Function change.
  - A one-time `create-signing-keystore.yml` workflow (manual dispatch, zip-password input) generates the keystore with random passwords and packs it with its base64 text and the four `ANDROID_KEYSTORE_*` values into a password-protected artifact, so the owner can add the secrets without installing anything; nothing secret is printed to the log.
- [x] **19.9 follow-up: one-secret signing, after the owner hit a TalkBack-silencing bug on GitHub's "Add secret" screen.** GitHub's own secret-entry page is outside this repository, so it cannot be fixed here; what could be fixed is how many and how large the pastes are. The signing keystore is now committed **encrypted** (`android-app/signing/release-keystore.b64`, AES-256-CBC, PBKDF2 200000 iterations) and the build workflow opens it with the single short `ANDROID_KEYSTORE_PASSWORD` secret — no 3.5 KB base64 paste, no alias, no second password; a wrong password fails the build with a plain-language message. The old `ANDROID_KEYSTORE_BASE64` path still takes precedence, and the temporary-key fallback remains. `create-signing-keystore.yml` was removed as superseded (nothing needs generating anymore). Blind Quiz's own forms were audited against the same checklist (real labels, no paste listeners, no input replacement, typing never intercepted, exit dialog returns focus) and a smoke block now asserts it.
- Build hardening after the owner's first runs: the keystore password secret is trimmed of stray whitespace and validated (48 hex characters) with plain-language errors, because screen-reader clipboard copies often carry a trailing space or line break; the release-publish step is rerun-safe (an existing release gets its assets replaced instead of a collision failure); mangled ANDROID_KEYSTORE_BASE64 values fail with a plain message too.
- First stable-signed release: **android-v1.0.17** was signed with the repository keystore ("Signing: repository keystore" in its notes), not a temporary key, because the owner's `ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD` secrets are set correctly. Signing certificate SHA-256 fingerprint: `7B:CE:E1:EB:90:3F:0B:7F:AC:61:4E:C1:C9:FF:93:76:5C:8F:AC:7D:C0:B6:3D:20:DA:6C:7C:95:47:18:E5:74` (matches the committed encrypted keystore, verified byte-for-byte). Releases before 1.0.17 used per-run temporary keys, so updating to 1.0.17 or later from an older install needs a one-time uninstall; from 1.0.17 on, updates install in place. The `ANDROID_KEYSTORE_BASE64` path takes precedence when present, and the committed encrypted keystore (opened by `ANDROID_KEYSTORE_PASSWORD` alone) produces the same signature, so both paths share one identity.
