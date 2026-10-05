import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// The app always loads the live site, so new questions and fixes arrive
/// without reinstalling. The site's network-first service worker keeps it
/// playable offline after the first visit.
const String kLiveUrl = 'https://mahicouragw.github.io/Blind-Quiz/';
const Color kBackground = Color(0xFF111D2B);
const Color kAcid = Color(0xFFD6FF5F);

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

class _QuizWebViewState extends State<QuizWebView> {
  late final WebViewController _controller;
  int _progress = 0;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(kBackground)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (p) => setState(() => _progress = p),
          onPageStarted: (_) => setState(() => _failed = false),
          onWebResourceError: (error) {
            // Only a failed main page counts; a missing image should not hide the game.
            if (error.isForMainFrame ?? true) setState(() => _failed = true);
          },
        ),
      )
      ..loadRequest(Uri.parse(kLiveUrl));
  }

  /// Fetches the latest version of the site. The HTTP cache is cleared first;
  /// the service worker is network-first, so the newest main.js and content.js load.
  Future<void> _reload() async {
    SemanticsService.announce('Reloading Blind Quiz to get the latest version.', TextDirection.ltr);
    setState(() => _failed = false);
    await _controller.clearCache();
    final current = await _controller.currentUrl();
    if (current == null || current == 'about:blank') {
      await _controller.loadRequest(Uri.parse(kLiveUrl));
    } else {
      await _controller.reload();
    }
  }

  Future<void> _handleBack() async {
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
        body: SafeArea(
          child: _failed
              ? _OfflineMessage(onRetry: _reload)
              : WebViewWidget(controller: _controller),
        ),
      ),
    );
  }
}

class _OfflineMessage extends StatelessWidget {
  const _OfflineMessage({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
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
    );
  }
}
