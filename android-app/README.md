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

For a stable signing identity (so new APKs install over old ones), add these repository
secrets (Settings -> Secrets and variables -> Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create a keystore with:

```sh
keytool -genkeypair -v -keystore release.jks -alias blindquiz -keyalg RSA -keysize 2048 -validity 10000
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
