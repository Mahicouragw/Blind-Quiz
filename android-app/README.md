# Blind Quiz for Android

A small Flutter app that shows the live site (https://mahicouragw.github.io/Blind-Quiz/) in a
WebView with a **Reload** button in the top bar. Because the app always loads the live site,
new questions and fixes arrive without reinstalling; Reload clears the WebView HTTP cache and
reloads, and the site's network-first service worker serves the newest files.

The installable PWA keeps working independently: open the site in Chrome and choose
"Install app" / "Add to Home screen".

## Security

- Only `https://mahicouragw.github.io/Blind-Quiz/...` loads inside the app; other HTTPS links open in the
  system browser and every other scheme (http, file, intent, javascript, data, ...) is blocked.
- Release builds disable WebView remote debugging and file access; the manifest sets
  `usesCleartextTraffic="false"` and `allowBackup="false"`. The only permissions are `INTERNET`,
  `RECORD_AUDIO`/`CAMERA`/`MODIFY_AUDIO_SETTINGS` (asked only when a call or voice message needs them)
  and `POST_NOTIFICATIONS` (asked the first time notifications are turned on) — verified by the
  workflow's audit on every signed APK.
- Reload clears only the HTTP cache. Web storage is kept, so a still-valid sign-in session survives;
  the site re-checks it with the server and shows Sign In when it has expired. Success and failure
  are announced to TalkBack.

## Notifications (no push service)

Friend requests, developer replies from Goldfish, announcements and game invites can appear as real
Android notifications while the game runs in the background. There is **no Firebase project, no push
service and no third party**: delivery is the page's own polling heartbeat (every 10 seconds while
the screen is on, every 60 in the background) — the same heartbeat that drives the bell.

The Android WebView has no browser Notification API, so the app bridges it:

- The WebView injects `window.BQNotifications`; the page posts `{op: state | permission | post | clear}`
  messages, and `MainActivity.kt` answers through `window.bqDeviceNotificationPermission`.
- Players turn notifications on in Settings ("Also show them as Android notifications"). Android 13+
  asks for `POST_NOTIFICATIONS` the first time; on older versions they are allowed from install.
- A background alert shows the notification's own words ("Bob sent you a friend request."), not just a
  count. While the game is in the foreground nothing is posted — the bell, the chime and the spoken
  announcement already tell the player. Turning the setting off clears the tray.
- Tapping a notification brings the app back and opens the in-app notifications list, also when the
  app is started fresh from the tray (the page is opened once it has finished loading).

## Building

The APK is built in GitHub Actions by `.github/workflows/build-android.yml`
(`subosito/flutter-action` + `android-actions/setup-android`). Only `pubspec.yaml`,
`lib/`, and `analysis_options.yaml` are committed; the workflow generates the `android/`
folder with `flutter create --platforms android`, adds the INTERNET permission and app
label, builds `flutter build apk --release`, signs it with `apksigner`, and publishes it
as a workflow artifact and a GitHub Release (`android-v1.0.<run>`).

### Signing

The signing key lives **inside this repository, encrypted**, so only **one short secret** is
needed — no base64 blob, no alias, no second password, nothing to generate with local tools:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_PASSWORD` | one line, 48 characters |

Add it in Settings -> Secrets and variables -> Actions -> New repository secret, then re-run
"Build Android APK". The workflow decrypts `signing/release-keystore.b64` (AES-256-CBC,
PBKDF2 200000 iterations) with the password, verifies it opens, and signs the APK. A wrong
password fails the build with a plain-language error instead of a cryptic one.

Why this is safe even though the repository is public: the file in Git is the 2048-bit RSA
signing key wrapped with AES-256 under a 48-random-hex-character password that exists only in
the repository secrets (and the owner's own backup). Guessing it is not feasible; the
unencrypted keystore was never committed. The release notes of every build say which signing
mode was used.

If `ANDROID_KEYSTORE_BASE64` (+ optional `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) are set
as well, they take precedence over the committed file — the old path still works. With no
secrets at all the build falls back to a temporary key (installs fine, but later builds cannot
update it in place).

Rotating the key (only if it ever leaks): create a new keystore, re-encrypt it with
`openssl enc -aes-256-cbc -pbkdf2 -iter 200000`, replace `signing/release-keystore.b64`, and
update the secret. Installed apps then update by uninstall-once, exactly like the first
stable install.

Create or inspect a keystore yourself (optional, needs Java's keytool):

```sh
keytool -genkeypair -v -keystore release.jks -alias blindquiz -keyalg RSA -keysize 2048 -validity 10000
keytool -list -keystore release.jks -storetype PKCS12
```

Without these secrets the workflow still produces a signed release APK, using a temporary
key generated for that run (the key is never uploaded). Such APKs install fine, but a later
build signed with a different key cannot update them in place - uninstall first. Content
updates never need a reinstall either way.

Local build (with Flutter and the Android SDK installed):

```sh
cd android-app
flutter create --platforms android --org io.github.mahicouragw --project-name blind_quiz .
flutter build apk --release
```
