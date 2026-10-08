package io.github.mahicouragw.blind_quiz

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import androidx.work.WorkManager

/**
 * Supplies WorkManager's configuration at process startup. The notification worker is
 * optional; a WorkManager initialization failure must never keep Flutter's main activity
 * from opening.
 */
class BlindQuizApplication : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        try {
            WorkManager.getInstance(this)
        } catch (notInitialized: IllegalStateException) {
            // Defensive fallback in case AndroidX Startup's provider was omitted by manifest merging.
            try {
                WorkManager.initialize(this, workManagerConfiguration)
                Log.i(TAG, "Initialized WorkManager using the app configuration provider")
            } catch (initializationFailure: IllegalStateException) {
                // It may have initialized between getInstance() and initialize(). Verify once;
                // rethrow only when WorkManager is genuinely still unavailable.
                try {
                    WorkManager.getInstance(this)
                    Log.i(TAG, "WorkManager initialized concurrently")
                } catch (stillUnavailable: IllegalStateException) {
                    stillUnavailable.addSuppressed(notInitialized)
                    stillUnavailable.addSuppressed(initializationFailure)
                    Log.e(TAG, "WorkManager is unavailable; notifications will be disabled", stillUnavailable)
                }
            }
        }
    }

    private companion object {
        const val TAG = "BlindQuizApp"
    }
}
