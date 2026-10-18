import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:blind_quiz/main.dart';

void main() {
  test('the app wraps the live HTTPS site', () {
    expect(kLiveUrl, 'https://mahicouragw.github.io/Blind-Quiz/');
    expect(Uri.parse(kLiveUrl).scheme, 'https');
  });

  test('only the Blind Quiz site over HTTPS opens inside the app', () {
    expect(classifyNavigation(kLiveUrl), NavDecision.inApp);
    expect(classifyNavigation('https://mahicouragw.github.io/Blind-Quiz/privacy-policy.html'), NavDecision.inApp);
    expect(classifyNavigation('https://mahicouragw.github.io/Blind-Quiz/terms-and-conditions.html'), NavDecision.inApp);
    expect(classifyNavigation('https://mahicouragw.github.io/Blind-Quiz#settings'), NavDecision.inApp);
  });

  test('other HTTPS links open in the external browser', () {
    expect(classifyNavigation('https://github.com/Mahicouragw/Blind-Quiz/issues'), NavDecision.external);
    expect(classifyNavigation('mailto:numbersareplaying@gmail.com?subject=Blind%20Quiz%20feedback'), NavDecision.external);
    expect(classifyNavigation('mailto:someone.else@example.com'), NavDecision.block);
    expect(classifyNavigation('https://mahicouragw.github.io/Other-Project/'), NavDecision.external);
    expect(classifyNavigation('https://mahicouragw.github.io.evil.example/Blind-Quiz/'), NavDecision.external);
  });

  test('insecure and dangerous schemes are blocked', () {
    for (final url in [
      'http://mahicouragw.github.io/Blind-Quiz/',
      'file:///data/data/io.github.mahicouragw.blind_quiz/shared_prefs/a.xml',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'intent://scan/#Intent;scheme=zxing;end',
      'content://com.android.contacts/contacts',
      'https://user:pass@mahicouragw.github.io/Blind-Quiz/',
      'not a url at all',
    ]) {
      expect(classifyNavigation(url), NavDecision.block, reason: url);
    }
  });

  testWidgets('offline panel is announced and its Try again button works', (tester) async {
    var retries = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: OfflineMessage(onRetry: () => retries++))));
    expect(find.text('Blind Quiz could not load. Check your internet connection, then try again.'), findsOneWidget);
    final handle = tester.ensureSemantics();
    expect(tester.getSemantics(find.text('Try again')), matchesSemantics(isButton: true, hasTapAction: true, label: 'Try again', isEnabled: true, hasEnabledState: true, isFocusable: true, hasFocusAction: true));
    await tester.tap(find.text('Try again'));
    expect(retries, 1);
    handle.dispose();
  });

  testWidgets('share panel shows the website QR code and link buttons', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: SharePanel())));
    expect(find.text('Share Blind Quiz'), findsOneWidget);
    expect(find.text(kLiveUrl), findsOneWidget);
    expect(find.text('Copy website link'), findsOneWidget);
    expect(find.text('Copy app download link'), findsOneWidget);
    expect(find.bySemanticsLabel('QR code for the Blind Quiz website'), findsOneWidget);
    expect(kApkUrl, startsWith('https://mahicouragw.github.io/Blind-Quiz/'));
  });

  test('files received from friends get safe names', () {
    expect(safeReceivedName('notes.pdf'), 'notes.pdf');
    expect(safeReceivedName('../../shared_prefs/a.xml'), '__.._shared_prefs_a.xml');
    expect(safeReceivedName('a/b\\c:d'), 'a_b_c_d');
    expect(safeReceivedName(''), 'file');
    expect(safeReceivedName('x' * 200).length, 120);
    expect(kMaxReceivedBytes, 2 * 1024 * 1024 * 1024);
  });
}
