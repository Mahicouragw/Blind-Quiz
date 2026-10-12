package io.github.mahicouragw.blind_quiz

import android.app.Application
import android.util.Log
import androidx.work.Configuration

/**
 * Supplies WorkManager configuration for lazy, on-demand initialization. Notification
 * scheduling is optional and is attempted by MainActivity without blocking app startup.
 */
class BlindQuizApplication : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()
}
