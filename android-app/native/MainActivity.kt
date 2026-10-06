package io.github.mahicouragw.blind_quiz

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// Asks Android for the microphone (calls, room voice messages) and camera (video calls) only when the
// Blind Quiz page needs them. Copied over the generated MainActivity by .github/workflows/build-android.yml.
class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null

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
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST) return
        pending?.success(grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED })
        pending = null
    }

    companion object { private const val REQUEST = 4207 }
}
