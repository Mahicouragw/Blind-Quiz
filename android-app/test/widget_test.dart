import 'package:flutter_test/flutter_test.dart';
import 'package:blind_quiz/main.dart';

void main() {
  test('the app wraps the live HTTPS site', () {
    expect(kLiveUrl, 'https://mahicouragw.github.io/Blind-Quiz/');
    expect(Uri.parse(kLiveUrl).scheme, 'https');
  });
}
