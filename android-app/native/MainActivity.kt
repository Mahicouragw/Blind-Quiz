package io.github.mahicouragw.blind_quiz

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// Native helpers for the Blind Quiz app, copied over the generated MainActivity by .github/workflows/build-android.yml:
//  - blind_quiz/permissions: microphone (calls, room voice messages) and camera (video calls), asked only when needed.
//  - blind_quiz/notify: background notifications (NotifyWorker.kt), phone notification permission and sound settings.
class MainActivity : FlutterActivity() {
    private var pendingMedia: MethodChannel.Result? = null
    private var pendingNotify: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Game updates reach everyone who installed the app; signed-in players also get their own notifications.
        BQNotify.createChannels(this)
        BQNotify.schedule(this)
        val p = BQNotify.prefs(this)
        if (Build.VERSION.SDK_INT >= 33 && !BQNotify.canNotify(this) && !p.getBoolean("asked", false)) {
            p.edit().putBoolean("asked", true).apply()
            requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), NOTIFY_FIRST)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, "blind_quiz/permissions").setMethodCallHandler { call, result ->
            if (call.method != "request") { result.notImplemented(); return@setMethodCallHandler }
            // Before Android 6 permissions are granted at install time.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) { result.success(true); return@setMethodCallHandler }
            val wanted = (call.arguments as? List<*>)?.mapNotNull {
                when (it) { "microphone" -> Manifest.permission.RECORD_AUDIO; "camera" -> Manifest.permission.CAMERA; else -> null }
            } ?: emptyList()
            val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            when {
                missing.isEmpty() -> result.success(true)
                pendingMedia != null -> result.success(false)
                else -> { pendingMedia = result; requestPermissions(missing.toTypedArray(), MEDIA) }
            }
        }
        MethodChannel(messenger, "blind_quiz/notify").setMethodCallHandler { call, result ->
            when (call.method) {
                "enable" -> {
                    BQNotify.enable(this, (call.arguments as? String) ?: "")
                    when {
                        BQNotify.canNotify(this) -> result.success(true)
                        pendingNotify != null -> result.success(false)
                        else -> { pendingNotify = result; requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), NOTIFY) }
                    }
                }
                "disable", "logout" -> { BQNotify.stop(this); result.success(true) }
                "sounds" -> { openSoundSettings(); result.success(true) }
                else -> result.notImplemented()
            }
        }
    }

    // Android's own notification settings for Blind Quiz: each kind has its own sound (any phone ringtone).
    private fun openSoundSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        else
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        try { startActivity(intent) } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        when (requestCode) {
            MEDIA -> { pendingMedia?.success(granted); pendingMedia = null }
            NOTIFY -> { pendingNotify?.success(granted); pendingNotify = null }
        }
    }

    companion object {
        private const val MEDIA = 4207
        private const val NOTIFY = 4208
        private const val NOTIFY_FIRST = 4209
    }
}
