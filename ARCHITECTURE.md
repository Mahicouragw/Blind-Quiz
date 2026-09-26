# Blind Quiz — architecture and build checklist

## Repository and source boundary
This project is built in the new `Mahicouragw/Blind-Quiz` repository, which was initially empty except for its README. No files, UI, data, styles, authentication, or game logic are being imported from any other project. Supabase project configuration supplied by the owner is used only as the public client endpoint/key; private database/secret keys are never placed in frontend code.

## Planned architecture
- Static, responsive PWA frontend: semantic HTML, CSS, and modular browser JavaScript; no frontend framework required.
- Validated, local structured starter question data for offline browsing/game sessions.
- Supabase Postgres with RLS enabled and private tables.
- Supabase Edge Function as the sole privileged application API: account creation (normalized unique display names and cryptographically random unique 8-character login IDs), login/recovery validation, protected game-answer/reward mutations, and profile/stat operations.
- Custom short-lived opaque sessions for the requested name + Login ID + secret-answer auth (no email/password/OTP); session secrets are stored hashed server-side. The secret answer is salted/slow-hashed and never returned by the API. Login attempts need server-side throttling. All user tables deny direct anon access; only the Edge Function's server secret can operate on them.
- Game answer/reward mutations must be checked against canonical database questions on the server. Local offline play must not mint transferable XP/coins or claim server-synced rewards.
- PWA caches the static shell and public question pack; account/reward/leaderboard APIs require network.

## Checklist / gates
1. [x] Inspect only the new repository; establish source boundary.
2. [x] Write architecture and risk checklist.
3. [ ] Build distinctive responsive UI and core navigation.
4. [ ] Build validated structured question bank and content tests.
5. [ ] Implement signup, unique normalized name, secure ID generation, and custom auth Edge Function.
6. [ ] Add RLS-protected schema and migrations; confirm no direct client access.
7. [ ] Implement and test countdown sequencing, question controls, scoring and gameplay.
8. [ ] Implement remaining modes only when each is genuinely playable.
9. [ ] Add profile/progression, power-ups, challenge/leaderboard/search/reporting with server validation.
10. [ ] Source licensed audio, document licenses, implement ducking and accessible settings.
11. [ ] Add PWA/offline support and verify cache behavior.
12. [ ] Run automated/static tests and build; repair issues.
13. [ ] Manual TalkBack testing on a real Android device is required; this workspace cannot claim that test was performed.
14. [ ] Deliver test build and stop. No production deployment without explicit user approval.

## Security/product caveat
The requested login is entirely based on a human-chosen secret answer, with no password, email, phone, or second factor. Such answers are often guessable. The design therefore requires salted slow hashing, strict rate limits, generic login errors, short-lived/revocable sessions, and never revealing answers. This is still weaker than a password/passkey-based credential and should not be used to protect sensitive information. The application must not collect sensitive personal information.
