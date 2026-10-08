package io.github.mahicouragw.blind_quiz

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import androidx.work.WorkManager

/**
 * Initializes WorkManager on demand with the app configuration. Notification work is
 * optional; a scheduler error must never prevent Flutter's main activity from opening.
 */
class BlindQuizApplication : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        try {
            WorkManager.initialize(this, workManagerConfiguration)
        } catch (alreadyInitialized: IllegalStateException) {
            // Keep startup resilient if another initializer initialized WorkManager first.
            try {
                WorkManager.getInstance(this)
                Log.i(TAG, "WorkManager was already initialized")
            } catch (notAvailable: IllegalStateException) {
                notAvailable.addSuppressed(alreadyInitialized)
                Log.e(TAG, "WorkManager unavailable; continuing without notifications", notAvailable)
            }
        }
    }

    private companion object {
        const val TAG = "BlindQuizApp"
    }
}
