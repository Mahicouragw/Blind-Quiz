package io.github.mahicouragw.blind_quiz

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// Two small native channels for the Blind Quiz page, copied over the generated MainActivity by
// .github/workflows/build-android.yml:
//
//   blind_quiz/permissions  - asks Android for the microphone (calls, room voice messages) and
//                             camera (video calls), only when the page needs them.
//   blind_quiz/notifications - shows real Android notifications (friend requests, replies,
//                             announcements, game invites). The Android WebView has no browser
//                             Notification API, so the page hands the text to this channel.
//                             Delivery is by the page's own polling heartbeat: no push service,
//                             no Firebase project and no third party is involved.
class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null
    private var pendingNotifications: MethodChannel.Result? = null
    private var notifications: MethodChannel? = null
    private var openNotificationsOnStart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app was started by tapping a Blind Quiz notification: open the notifications list
        // once the page has loaded (the Dart side waits for the page before running it).
        openNotificationsOnStart = intent?.getBooleanExtra(EXTRA_OPEN_NOTIFICATIONS, false) == true
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "blind_quiz/permissions").setMethodCallHandler { call, result ->
            if (call.method != "request") { result.notImplemented(); return@setMethodCallHandler }
            // Before Android 6 permissions are granted at install time.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) { result.success(true); return@setMethodCallHandler }
            val wanted = (call.arguments as? List<*>)?.mapNotNull {
                when (it) { "microphone" -> Manifest.permission.RECORD_AUDIO; "camera" -> Manifest.permission.CAMERA; else -> null }
            } ?: emptyList()
            val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            when {
                missing.isEmpty() -> result.success(true)
                pending != null -> result.success(false)
                else -> { pending = result; requestPermissions(missing.toTypedArray(), REQUEST) }
            }
        }
        createNotificationChannel()
        notifications = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "blind_quiz/notifications")
            .also { channel ->
                channel.setMethodCallHandler { call, result ->
                    when (call.method) {
                        "state" -> result.success(notificationsAllowed())
                        "request" -> requestNotificationsPermission(result)
                        "post" -> {
                            post(call.argument<String>("title") ?: "Blind Quiz", call.argument<String>("body").orEmpty(), call.argument<Int>("id") ?: 0)
                            result.success(true)
                        }
                        "clear" -> { manager()?.cancelAll(); result.success(true) }
                        else -> result.notImplemented()
                    }
                }
            }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_OPEN_NOTIFICATIONS, false)) notifications?.invokeMethod("opened", null)
    }

    override fun onResume() {
        super.onResume()
        if (!openNotificationsOnStart) return
        openNotificationsOnStart = false
        notifications?.invokeMethod("opened", null)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        when (requestCode) {
            REQUEST -> { pending?.success(granted); pending = null }
            REQUEST_NOTIFICATIONS -> { pendingNotifications?.success(granted); pendingNotifications = null }
        }
    }

    // ---- Android notifications -------------------------------------------------------------------

    private fun manager(): NotificationManager? = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val m = manager() ?: return
        if (m.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Blind Quiz notifications", NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = "Friend requests, developer replies, announcements and game invites."
        m.createNotificationChannel(channel)
    }

    // Android 13 (API 33) asks first; on older versions notifications are allowed from install.
    private fun notificationsAllowed(): Boolean =
        Build.VERSION.SDK_INT < 33 || checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun requestNotificationsPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < 33) { result.success(true); return }
        if (checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { result.success(true); return }
        if (pendingNotifications != null) { result.success(false); return }
        pendingNotifications = result
        requestPermissions(arrayOf(POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }

    private fun openIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_OPEN_NOTIFICATIONS, true)
        }
        // FLAG_IMMUTABLE is required from Android 12; the page never reads this intent's contents.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getActivity(this, 0, intent, flags)
    }

    @Suppress("DEPRECATION") // Notification.Builder(context) is only used below Android 8, which has no channels.
    private fun post(title: String, body: String, id: Int) {
        val text = body.trim()
        if (text.isEmpty()) return
        val m = manager() ?: return
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
        else Notification.Builder(this)
        val notification = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(openIntent())
            .setAutoCancel(true)
            .build()
        // A missing POST_NOTIFICATIONS grant throws on Android 13+, so posting stays optional.
        try {
            m.notify(if (id == 0) text.hashCode() else id, notification)
        } catch (_: SecurityException) {
        }
    }

    companion object {
        private const val REQUEST = 4207
        private const val REQUEST_NOTIFICATIONS = 4208
        private const val CHANNEL_ID = "blind_quiz_notifications"
        private const val EXTRA_OPEN_NOTIFICATIONS = "io.github.mahicouragw.blind_quiz.OPEN_NOTIFICATIONS"
        // Written as a literal so the build does not depend on a particular compileSdk level.
        private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
    }
}
