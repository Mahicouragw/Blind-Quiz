package io.github.mahicouragw.blind_quiz

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import androidx.work.WorkManager

/**
 * Provides WorkManager's configuration through AndroidX Startup. Notification work is
 * optional; an unavailable worker must never prevent Flutter's main activity from opening.
 */
class BlindQuizApplication : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        try {
            // AndroidX Startup has already run providers before Application.onCreate().
            WorkManager.getInstance(this)
        } catch (e: IllegalStateException) {
            Log.e(TAG, "WorkManager auto-initializer unavailable; notifications are disabled", e)
        }
    }

    private companion object {
        const val TAG = "BlindQuizApp"
    }
}
