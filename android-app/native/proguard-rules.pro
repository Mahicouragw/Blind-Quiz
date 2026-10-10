# WorkManager constructs its Room database implementation by reflection. R8 full
# mode can strip the generated implementation's no-argument constructor, which
# makes release startup fail even though debug builds work.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# WorkManager also creates InputMerger implementations reflectively for jobs.
-keep class * extends androidx.work.InputMerger { <init>(); }

# WorkManager loads these app workers reflectively in release builds.
-keep class io.github.mahicouragw.blind_quiz.NotifyWorker { public <init>(android.content.Context, androidx.work.WorkerParameters); }
-keep class io.github.mahicouragw.blind_quiz.ReceivedFileCleanupWorker { public <init>(android.content.Context, androidx.work.WorkerParameters); }
