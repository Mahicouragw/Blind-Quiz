import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// The app always loads the live site, so new questions and fixes arrive
/// without reinstalling. The site's network-first service worker keeps it
/// playable offline after the first visit.
const String kLiveUrl = 'https://mahicouragw.github.io/Blind-Quiz/';
const String kAppHost = 'mahicouragw.github.io';
const String kAppPathPrefix = '/Blind-Quiz';
const Color kBackground = Color(0xFF1B1036);
const Color kAcid = Color(0xFFFFC94A);
const Color kMint = Color(0xFF5EE6C8);
const Color kCream = Color(0xFFFFF8EC);

/// Permanent download link for the newest APK (served from the website itself).
const String kApkUrl = 'https://mahicouragw.github.io/Blind-Quiz/download/blind-quiz.apk';

/// What the WebView may do with a navigation.
enum NavDecision { inApp, external, block }

/// The developer's contact address: the only mailto: link the app opens (in the user's email app).
const String kContactEmail = 'numbersareplaying@gmail.com';

/// Only the Blind Quiz site itself, over HTTPS, opens inside the app. Other
/// HTTPS links (for example GitHub in the legal pages) open in the user's own
/// browser. Everything else (http, intent:, file:, javascript:, data:, custom
/// schemes) is blocked.
/// A safe file name for a file a friend sent directly (no folders, no control characters).
String safeReceivedName(String name) {
  final cleaned = name.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), '_').replaceAll(RegExp(r'^\.+'), '_').trim();
  final cut = cleaned.length > 120 ? cleaned.substring(0, 120) : cleaned;
  return cut.isEmpty ? 'file' : cut;
}

/// Microphone and camera requests handled by android-app/native/MainActivity.kt.
const MethodChannel kPermissions = MethodChannel('blind_quiz/permissions');

/// Background notifications and phone sound settings handled by android-app/native/NotifyWorker.kt and MainActivity.kt.
const MethodChannel kNotify = MethodChannel('blind_quiz/notify');

/// The page's notification requests the app accepts (src/social.js).
const Set<String> kNotifyOps = <String>{'enable', 'disable', 'logout', 'sounds'};

/// Largest file a friend can send directly (matches src/direct.js).
const int kMaxReceivedBytes = 2 * 1024 * 1024 * 1024;

/// Temporary received copies are removed after three hours (matches src/direct.js).
const Duration kReceivedFileTtl = Duration(hours: 3);

NavDecision classifyNavigation(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return NavDecision.block;
  if (uri.scheme == 'about' && url == 'about:blank') return NavDecision.inApp;
  if (uri.scheme == 'mailto') {
    return uri.path.toLowerCase() == kContactEmail ? NavDecision.external : NavDecision.block;
  }
  if (uri.scheme != 'https') return NavDecision.block;
  if (uri.host.isEmpty || uri.userInfo.isNotEmpty) return NavDecision.block;
  if (uri.host == kAppHost &&
      (uri.path == kAppPathPrefix || uri.path.startsWith('$kAppPathPrefix/'))) {
    return NavDecision.inApp;
  }
  return NavDecision.external;
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BlindQuizApp());
}

class BlindQuizApp extends StatelessWidget {
  const BlindQuizApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Blind Quiz',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: kAcid,
          brightness: Brightness.dark,
          surface: kBackground,
        ),
        scaffoldBackgroundColor: kBackground,
        useMaterial3: true,
      ),
      home: const QuizWebView(),
    );
  }
}

class QuizWebView extends StatefulWidget {
  const QuizWebView({super.key});

  @override
  State<QuizWebView> createState() => _QuizWebViewState();
}

class _QuizWebViewState extends State<QuizWebView> with WidgetsBindingObserver {
  late final WebViewController _controller;
  int _progress = 0;
  bool _failed = false;
  bool _reloading = false;
  final Map<String, _Incoming> _incoming = <String, _Incoming>{};
  final Map<String, Timer> _receivedTimers = <String, Timer>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Calls and voice messages: the page asks for the microphone (and camera for video calls); Android asks the player.
    _controller = WebViewController(onPermissionRequest: _onPermissionRequest)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(kBackground)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _onNavigationRequest,
          onProgress: (p) {
            if (mounted) setState(() => _progress = p);
          },
          onPageStarted: (_) {
            if (mounted) setState(() => _failed = false);
          },
          onPageFinished: (_) {
            if (!mounted || !_reloading || _failed) return;
            _reloading = false;
            _say('Blind Quiz reloaded.');
          },
          onWebResourceError: (error) {
            // Only a failed main page counts; a missing image should not hide the game.
            if (!(error.isForMainFrame ?? true) || !mounted) return;
            setState(() => _failed = true);
            if (_reloading) {
              _reloading = false;
              _say('Reload failed. Check your internet connection, then try again.');
            }
          },
        ),
      );

    // Hardening for the Android WebView: no remote debugging in release builds and
    // no access to files on the device.
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(kDebugMode);
      platform.setAllowFileAccess(false);
      // Settings > Send feedback can attach a screenshot: the page's <input type="file" accept="image/*">
      // opens the system photo picker (no storage permission). Only the chosen image is handed to the page.
      platform.setOnShowFileSelector(_pickForPage);
      // Call audio from a friend starts playing as soon as the call connects.
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    // Files a friend sends directly arrive in pieces from the page and are offered to save or open.
    _controller.addJavaScriptChannel('BQFiles', onMessageReceived: (m) => _onFileMessage(m.message));
    // Phone notifications while the app is closed, and each kind's own sound in Android settings.
    _controller.addJavaScriptChannel('BQNotify', onMessageReceived: (m) => _onNotifyMessage(m.message));
    _cleanReceived();
    _controller.loadRequest(Uri.parse(kLiveUrl));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _cleanReceived();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _onPermissionRequest(WebViewPermissionRequest request) async {
    final wantsCamera = request.types.contains(WebViewPermissionResourceType.camera);
    final wantsMic = request.types.contains(WebViewPermissionResourceType.microphone);
    if (!wantsCamera && !wantsMic) {
      await request.deny();
      return;
    }
    var granted = false;
    try {
      granted = await kPermissions.invokeMethod<bool>('request', <String>[if (wantsMic) 'microphone', if (wantsCamera) 'camera']) ?? false;
    } catch (_) {
      granted = false;
    }
    if (granted) {
      await request.grant();
    } else {
      await request.deny();
      _say(wantsCamera ? 'Blind Quiz needs the microphone and camera for video calls. You can allow them in Android settings.' : 'Blind Quiz needs the microphone for calls and voice messages. You can allow it in Android settings.');
    }
  }

  /// Images (feedback screenshots) use the photo picker; any other file (Send a file) uses the system file picker.
  Future<List<String>> _pickForPage(FileSelectorParams params) async {
    final types = params.acceptTypes.where((t) => t.trim().isNotEmpty).toList();
    final imagesOnly = types.isNotEmpty && types.every((t) => t.startsWith('image/'));
    if (imagesOnly) return _pickImageForPage(params);
    try {
      final picked = await openFile();
      if (picked == null || picked.path.isEmpty) return <String>[];
      return <String>[Uri.file(picked.path).toString()];
    } catch (_) {
      _say('The file could not be opened. Please try again.');
      return <String>[];
    }
  }

  Future<void> _onNotifyMessage(String raw) async {
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final op = (m['op'] ?? '').toString();
      if (!kNotifyOps.contains(op)) return;
      if (op == 'enable') {
        final token = (m['token'] ?? '').toString();
        if (!RegExp(r'^[A-Za-z0-9_-]{35,64}$').hasMatch(token)) return;
        final granted = await kNotify.invokeMethod<bool>('enable', token) ?? false;
        await _controller.runJavaScript('globalThis.bqAppNotify && globalThis.bqAppNotify({op: "enabled", granted: ${granted ? 'true' : 'false'}})');
      } else {
        await kNotify.invokeMethod<bool>(op);
      }
    } catch (_) {}
  }

  Future<Directory> _receivedDir() async {
    final dir = Directory('${(await getTemporaryDirectory()).path}/received');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// The in-app hand-off copy expires after three hours; copies saved elsewhere belong to the recipient.
  Future<void> _cleanReceived() async {
    try {
      final dir = await _receivedDir();
      final cutoff = DateTime.now().subtract(kReceivedFileTtl);
      final activePaths = _incoming.values.map((inc) => inc.file.path).toSet();
      await for (final f in dir.list()) {
        if (f is File && !activePaths.contains(f.path) && (await f.lastModified()).isBefore(cutoff)) {
          await f.delete();
        }
      }
    } catch (_) {}
  }

  void _scheduleReceivedExpiry(String id, File file) {
    _receivedTimers.remove(id)?.cancel();
    _receivedTimers[id] = Timer(kReceivedFileTtl, () {
      _receivedTimers.remove(id);
      unawaited(_deleteReceived(file));
    });
  }

  Future<void> _deleteReceived(File file) async {
    try { if (await file.exists()) await file.delete(); } catch (_) {}
  }

  Future<void> _onFileMessage(String raw) async {
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final id = (m['id'] ?? '').toString();
      if (!RegExp(r'^[0-9a-f-]{36}$').hasMatch(id)) return;
      switch (m['op']) {
        case 'open':
          final size = (m['size'] as num?)?.toInt() ?? -1;
          if (size < 0 || size > kMaxReceivedBytes || _incoming.containsKey(id)) return;
          final file = File('${(await _receivedDir()).path}/$id-${safeReceivedName((m['name'] ?? 'file').toString())}');
          _incoming[id] = _Incoming(file, file.openWrite(), size, (m['mime'] ?? 'application/octet-stream').toString(), safeReceivedName((m['name'] ?? 'file').toString()));
        case 'chunk':
          final inc = _incoming[id];
          if (inc == null) return;
          final bytes = base64Decode((m['data'] ?? '').toString());
          inc.written += bytes.length;
          if (inc.written > inc.size) {
            await inc.sink.close();
            _incoming.remove(id);
            await inc.file.delete();
            return;
          }
          inc.sink.add(bytes);
        case 'close':
          final inc = _incoming.remove(id);
          if (inc == null) return;
          await inc.sink.flush();
          await inc.sink.close();
          if (inc.written != inc.size) {
            await inc.file.delete();
            _say('The file did not arrive completely.');
            return;
          }
          _scheduleReceivedExpiry(id, inc.file);
          await SharePlus.instance.share(ShareParams(files: <XFile>[XFile(inc.file.path, mimeType: inc.mime, name: inc.name)], subject: inc.name));
      }
    } catch (_) {
      _say('The file could not be saved. Please try again.');
    }
  }

  Future<List<String>> _pickImageForPage(FileSelectorParams params) async {
    try {
      final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000, maxHeight: 2000, imageQuality: 85);
      if (picked == null) return <String>[];
      return <String>[Uri.file(picked.path).toString()];
    } catch (_) {
      _say('The screenshot could not be opened. Please try again.');
      return <String>[];
    }
  }

  Future<NavigationDecision> _onNavigationRequest(NavigationRequest request) async {
    switch (classifyNavigation(request.url)) {
      case NavDecision.inApp:
        return NavigationDecision.navigate;
      case NavDecision.external:
        if (request.isMainFrame) {
          var opened = false;
          try {
            opened = await launchUrl(Uri.parse(request.url), mode: LaunchMode.externalApplication);
          } catch (_) {
            opened = false;
          }
          if (!opened) _say('That link could not be opened.');
        }
        return NavigationDecision.prevent;
      case NavDecision.block:
        if (request.isMainFrame) _say('That link is not supported in the app.');
        return NavigationDecision.prevent;
    }
  }

  /// SnackBars are announced automatically by TalkBack.
  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 3)));
  }

  /// Fetches the latest version of the site without closing the app. Only the HTTP
  /// cache is cleared; web storage is kept, so a still-valid sign-in session survives
  /// (the site re-checks it with the server and shows Sign In if it has expired).
  Future<void> _reload() async {
    _say('Reloading Blind Quiz to get the latest version.');
    setState(() {
      _failed = false;
      _reloading = true;
    });
    try {
      await _controller.clearCache();
      final current = await _controller.currentUrl();
      if (current == null || classifyNavigation(current) != NavDecision.inApp || current == 'about:blank') {
        await _controller.loadRequest(Uri.parse(kLiveUrl));
      } else {
        await _controller.reload();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _reloading = false;
      });
      _say('Reload failed. Check your internet connection, then try again.');
    }
  }

  Future<void> _handleBack() async {
    if (_failed) {
      setState(() => _failed = false);
      if (await _controller.canGoBack()) await _controller.goBack();
      return;
    }
    if (await _controller.canGoBack()) {
      await _controller.goBack();
    } else {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: kBackground,
          foregroundColor: Colors.white,
          title: const Text('Blind Quiz'),
          actions: [
            Semantics(
              button: true,
              label: 'Share Blind Quiz: show the QR code and link',
              excludeSemantics: true,
              child: IconButton(
                onPressed: () => showShareSheet(context),
                color: kMint,
                iconSize: 28,
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                icon: const Icon(Icons.qr_code_2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Semantics(
                button: true,
                label: 'Reload to get the latest version',
                excludeSemantics: true,
                child: TextButton.icon(
                  onPressed: _reload,
                  style: TextButton.styleFrom(
                    foregroundColor: kAcid,
                    minimumSize: const Size(48, 48),
                  ),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reload'),
                ),
              ),
            ),
          ],
          bottom: _progress < 100
              ? PreferredSize(
                  preferredSize: const Size.fromHeight(3),
                  child: ExcludeSemantics(
                    child: LinearProgressIndicator(value: _progress / 100, color: kAcid, minHeight: 3),
                  ),
                )
              : null,
        ),
        // The WebView stays in the tree under the offline panel so its page state
        // and web storage (including the sign-in session) are never torn down.
        body: SafeArea(
          child: Stack(
            children: [
              ExcludeSemantics(
                excluding: _failed,
                child: WebViewWidget(controller: _controller),
              ),
              if (_failed) Positioned.fill(child: OfflineMessage(onRetry: _reload)),
            ],
          ),
        ),
      ),
    );
  }
}

class OfflineMessage extends StatelessWidget {
  const OfflineMessage({super.key, required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: kBackground,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                liveRegion: true,
                child: const Text(
                  'Blind Quiz could not load. Check your internet connection, then try again.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white, fontSize: 20),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: onRetry,
                style: FilledButton.styleFrom(
                  backgroundColor: kAcid,
                  foregroundColor: kBackground,
                  minimumSize: const Size(160, 52),
                ),
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Opens the share panel with the website QR code.
Future<void> showShareSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: kBackground,
    isScrollControlled: true,
    builder: (_) => const SharePanel(),
  );
}

/// Website QR code and links, so players can invite friends from the app.
class SharePanel extends StatelessWidget {
  const SharePanel({super.key});

  Future<void> _copy(BuildContext context, String text, String what) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$what copied.')));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              header: true,
              child: const Text('Share Blind Quiz', style: TextStyle(color: kAcid, fontSize: 24, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(height: 8),
            const Text('Scan this code to play in any browser.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 17)),
            const SizedBox(height: 16),
            Semantics(
              image: true,
              label: 'QR code for the Blind Quiz website',
              excludeSemantics: true,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: kCream, borderRadius: BorderRadius.circular(20)),
                child: QrImageView(data: kLiveUrl, size: 220, backgroundColor: kCream, eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: kBackground), dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: kBackground)),
              ),
            ),
            const SizedBox(height: 12),
            const SelectableText(kLiveUrl, textAlign: TextAlign.center, style: TextStyle(color: kMint, fontSize: 15)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              alignment: WrapAlignment.center,
              children: [
                FilledButton(
                  onPressed: () => _copy(context, kLiveUrl, 'Website link'),
                  style: FilledButton.styleFrom(backgroundColor: kAcid, foregroundColor: kBackground, minimumSize: const Size(160, 52)),
                  child: const Text('Copy website link'),
                ),
                OutlinedButton(
                  onPressed: () => _copy(context, kApkUrl, 'App download link'),
                  style: OutlinedButton.styleFrom(foregroundColor: kMint, side: const BorderSide(color: kMint, width: 2), minimumSize: const Size(160, 52)),
                  child: const Text('Copy app download link'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: TextButton.styleFrom(foregroundColor: Colors.white, minimumSize: const Size(120, 52)),
                  child: const Text('Close'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A file a friend is sending directly, written piece by piece.
class _Incoming {
  _Incoming(this.file, this.sink, this.size, this.mime, this.name);
  final File file;
  final IOSink sink;
  final int size;
  final String mime;
  final String name;
  int written = 0;
}
