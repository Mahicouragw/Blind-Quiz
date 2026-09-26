# Blind Quiz

An audio-first quiz game designed for blind and sighted players. This project is being built from scratch in this repository; it does not reuse another application's source or question data.

## Run the current frontend

Requires Node.js 20+ for the content smoke test; the frontend itself is static.

```sh
npm test
python3 -m http.server 4173
```

Open `http://localhost:4173`. Core question browsing and quiz rounds use the local starter pack. Account creation and cloud-synced rewards remain unavailable until the database migration, seed data, and Edge Function below have been installed in the Supabase project.

## Supabase setup (owner action required)

The browser uses only the supplied project URL and **publishable** key in `src/config.js`. Do not put a Supabase secret/service-role key in the repository or browser.

1. Install the Supabase CLI and authenticate: `npx supabase login`.
2. Link this repository to the project ref `zchircgdkyjnowqcdwvf`: `npx supabase link --project-ref zchircgdkyjnowqcdwvf`.
3. Apply schema: `npx supabase db push` (or run `supabase/migrations/202609260001_core.sql` in the Supabase SQL editor).
4. Load the starter pack by running `npm run validate:content`, then execute `supabase/seed.sql` in the SQL editor.
5. Deploy the custom API: `npx supabase functions deploy blind-quiz-api --no-verify-jwt`.
6. In Edge Function secrets, set `BQ_RATE_LIMIT_PEPPER` to a newly generated random secret, and set `BQ_ALLOWED_ORIGINS` to the exact app origin(s) used for testing/hosting (comma-separated; include the local origin while testing). Never share this pepper or a Supabase secret key.
7. Verify sign-up, normalized-name duplicate rejection, question lookup, login, logout, and reward recording using two test accounts before broader user testing.

The custom auth model deliberately has no email, password, phone, or OTP. It stores a salted PBKDF2 hash of the secret answer, uses random 8-character IDs, generic credential errors, server-side rate limiting and opaque expiring sessions. The secret-answer-only model remains weaker than passkeys/passwords; do not use sensitive personal information as an answer. Never reuse its answers elsewhere.

## Current scope / not yet complete

The present build includes a distinctive responsive shell, 73 structured starter questions across 16 categories, category/classic/rapid/random/vocabulary/abbreviation/Braille entry points, timed rapid play, countdown, answer feedback, accessibility settings, generated Web Audio tones, a PWA shell, core database migration, and a custom-auth Edge Function source.

This is an early test build, not the complete product. Not implemented yet: the full requested question volume and editorial source audit; advanced Braille contractions/levels; most requested mini-games; power-ups; full progression/challenges/achievements/leaderboards/profile/search/reports/admin; background music; robust offline account sync; production deployment; and manual Android TalkBack/VoiceOver certification. Features not implemented are intentionally not shown as working controls. Do not use production data until the schema/function is installed and tested.

## Validation

```sh
npm test
```

The test validates question shape/uniqueness, core accessible markup/settings, and security/schema source invariants. It is not a substitute for live Supabase integration tests or manual TalkBack testing.

## Deployment policy

No workflow in this repository automatically deploys the application. Build/test and user manual testing must finish first. Production deployment requires the owner's explicit instruction.
