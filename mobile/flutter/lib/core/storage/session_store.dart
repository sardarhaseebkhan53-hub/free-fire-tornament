import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models.dart';

class SessionStore {
  static const _accessKey = 'clutchnex.access-token';
  static const _refreshCookieKey = 'clutchnex.refresh-cookie';
  static const _cachedUserKey = 'clutchnex.cached-user';

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  final StreamController<void> _expired = StreamController<void>.broadcast();

  Stream<void> get sessionExpired => _expired.stream;

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  Future<void> writeAccessToken(String value) =>
      _storage.write(key: _accessKey, value: value);

  Future<String?> readRefreshCookie() => _storage.read(key: _refreshCookieKey);

  Future<void> writeRefreshCookie(String value) =>
      _storage.write(key: _refreshCookieKey, value: value);

  Future<JsonMap?> readCachedUser() async {
    final value = await _storage.read(key: _cachedUserKey);
    if (value == null) return null;
    try {
      return asJson(jsonDecode(value));
    } on FormatException {
      await _storage.delete(key: _cachedUserKey);
      return null;
    }
  }

  Future<void> cacheUser(JsonMap user) =>
      _storage.write(key: _cachedUserKey, value: jsonEncode(user));

  Future<void> clearSession() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshCookieKey),
      _storage.delete(key: _cachedUserKey),
    ]);
  }

  Future<void> expireSession() async {
    await clearSession();
    if (!_expired.isClosed) _expired.add(null);
  }

  Future<void> dispose() => _expired.close();
}
