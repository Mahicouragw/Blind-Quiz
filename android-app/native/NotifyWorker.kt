package io.github.mahicouragw.blind_quiz

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

// Background notifications without Firebase or any paid service: Android runs this check about every
// 15 minutes (the shortest interval Android allows). The phone key can only read the player's own new
// notifications. Copied into the generated Android project by .github/workflows/build-android.yml.
object BQNotify {
    private const val API = "https://zchircgdkyjnowqcdwvf.supabase.co/functions/v1/blind-quiz-api"
    private const val KEY = "sb_publishable_raQlRdkDriEGoGj0iZ3ZhQ_e6CofOfM"
    const val NEWS = "https://mahicouragw.github.io/Blind-Quiz/news.json"
    const val PREFS = "bq_notify"

    // One channel per kind, so each can have its own sound (any phone ringtone) in Android settings.
    private val CHANNELS = listOf(
        arrayOf("bq_friends", "Friend requests", "Friend requests and accepted requests"),
        arrayOf("bq_messages", "Messages", "New private messages from friends"),
        arrayOf("bq_feedback", "Feedback replies", "Replies from the developer to your feedback"),
        arrayOf("bq_games", "Game invites", "Invitations to rooms and games"),
        arrayOf("bq_announcements", "Announcements", "Announcements from the Blind Quiz developer"),
        arrayOf("bq_updates", "Game updates", "New games and features in Blind Quiz"),
    )

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        for (c in CHANNELS) {
            val ch = NotificationChannel(c[0], c[1], NotificationManager.IMPORTANCE_HIGH)
            ch.description = c[2]
            nm.createNotificationChannel(ch)
        }
    }

    fun schedule(ctx: Context) {
        val request = PeriodicWorkRequest.Builder(NotifyWorker::class.java, 15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("bq-notify", ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun enable(ctx: Context, token: String) {
        if (token.length < 35 || token.length > 64) return
        prefs(ctx).edit().putString("token", token).apply()
        createChannels(ctx)
        schedule(ctx)
    }

    // Sign out or turn off: forget the key here and remove it on the server.
    fun stop(ctx: Context) {
        val p = prefs(ctx)
        val token = p.getString("token", null)
        p.edit().remove("token").remove("after").apply()
        if (token != null) Thread {
            try { post(JSONObject().put("action", "notify-check").put("token", token).put("afterId", 0).put("stop", true)) } catch (_: Exception) {}
        }.start()
    }

    fun post(body: JSONObject): Pair<Int, JSONObject?> {
        val c = URL(API).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15000
            c.readTimeout = 15000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("apikey", KEY)
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Pair(code, try { JSONObject(text) } catch (_: Exception) { null })
        } finally {
            c.disconnect()
        }
    }

    fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun show(ctx: Context, channel: String, id: Int, title: String, text: String) {
        if (!canNotify(ctx)) return
        val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        NotificationManagerCompat.from(ctx).notify(id, n)
    }
}

class NotifyWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        BQNotify.createChannels(ctx)
        val p = BQNotify.prefs(ctx)
        try { checkNews(ctx, p) } catch (_: Exception) {}
        val token = p.getString("token", null) ?: return Result.success()
        return try {
            var after = p.getLong("after", 0L)
            val (code, d) = BQNotify.post(JSONObject().put("action", "notify-check").put("token", token).put("afterId", after))
            if (code == 401) { p.edit().remove("token").apply(); return Result.success() }
            if (d == null || !d.optBoolean("ok")) return Result.retry()
            val items = d.optJSONArray("items") ?: JSONArray()
            for (i in 0 until items.length()) {
                val n = items.getJSONObject(i)
                after = maxOf(after, n.optLong("id"))
                showItem(ctx, n)
            }
            // Notifications already read in the game are never shown later.
            after = maxOf(after, d.optLong("latest", after))
            p.edit().putLong("after", after).apply()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun showItem(ctx: Context, n: JSONObject) {
        val who = n.optString("actor").ifEmpty { "A player" }
        val body = n.optString("body")
        val (channel, title, text) = when (n.optString("kind")) {
            "friend_request" -> Triple("bq_friends", "Friend request", "$who wants to be your friend.")
            "friend_accepted" -> Triple("bq_friends", "New friend", "$who accepted your friend request.")
            "message" -> Triple("bq_messages", "New message", "$who sent you a message. Open Blind Quiz to read it.")
            "feedback_reply" -> Triple("bq_feedback", "Reply to your feedback", body.ifEmpty { "The developer replied to your feedback." })
            "room_invite" -> Triple("bq_games", "Room invite", "$who invited you to a room.")
            "game_invite" -> Triple("bq_games", "Game invite", "$who invited you to play.")
            "announcement" -> Triple("bq_announcements", "Blind Quiz", body.ifEmpty { "New announcement." })
            else -> return
        }
        BQNotify.show(ctx, channel, 1000 + (n.optLong("id") % 1000000L).toInt(), title, text)
    }

    // Automatic update notification: whenever news.json on the website gets a new id (within two weeks of its date).
    private fun checkNews(ctx: Context, p: SharedPreferences) {
        val c = URL("${BQNotify.NEWS}?t=${System.currentTimeMillis() / 600000L}").openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 15000
        c.useCaches = false
        val text = try {
            if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText() } else null
        } finally {
            c.disconnect()
        } ?: return
        val n = JSONObject(text)
        val id = n.optString("id")
        if (id.isEmpty() || id == p.getString("news", null)) return
        p.edit().putString("news", id).apply()
        val date = try { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(n.optString("date"))?.time ?: 0L } catch (_: Exception) { 0L }
        if (System.currentTimeMillis() - date > 14L * 24 * 3600 * 1000) return
        BQNotify.show(ctx, "bq_updates", 1, n.optString("title", "New in Blind Quiz").take(80), n.optString("text").take(240))
    }
}
