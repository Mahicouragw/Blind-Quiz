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
- Fisher–Yates shuffling independently randomizes question order and each four-choice answer list. Correctness remains tied to the canonical answer text.

## Content

- 325 questions across 20 categories.
- IDs `bq-en-0001`–`bq-en-0073` preserve the source snapshot’s starter pack.
- The live database was verified to contain 114 rows with a highest ID of `bq-en-0414`; missing numeric IDs are not reused.
- Migration 009 adds IDs `bq-en-0415`–`bq-en-0666`: 12 additions per category plus 12 additional Telugu/Bharati Braille vowel questions.
- Structural checks enforce unique IDs/prompts/answers, one listed correct answer, explanations, valid difficulties, rewards, and source notes on new rows.

## Backend and security

- The browser has only the Supabase URL and publishable key.
- All profile/question tables have RLS and deny direct anonymous/authenticated access.
- The Edge Function implements the requested Name + Login ID + Secret Answer flow with salted PBKDF2 hashes, generic errors, rate limits, opaque sessions, and server-side answer/reward validation.
- Correct answers earn canonical XP/coins once per profile/question. The database function updates XP, coins, level, current/best streak, and answer totals atomically.
- The custom secret-answer credential remains weaker than a password or passkey. Players must not use sensitive or reused answers.

## Readiness gaps

- Migration 009 is prepared, not applied until the owner confirms it.
- The owner verified the remote question count and maximum ID in the SQL editor, but the workspace has no authorized Supabase CLI session, so migration history, Edge Function version, and live auth/reward behavior cannot be independently verified or deployed here.
- No website deployment workflow is configured.
- Achievements, combo rewards, quiz-completion persistence, daily-bank selection, and a complete profile UI are not implemented.
- Automated checks do not replace manual TalkBack, VoiceOver, keyboard, zoom/reflow, and mobile-device testing.
- No recorded audio has passed license and clue-matching review, so audio clues/music/effects remain absent.
