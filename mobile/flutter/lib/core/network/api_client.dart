import 'dart:async';

import 'package:dio/dio.dart';

import '../config.dart';
import '../models.dart';
import '../storage/session_store.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.code, this.statusCode});

  final String message;
  final String? code;
  final int? statusCode;

  @override
  String toString() => message;
}

class LoginResult {
  const LoginResult({required this.accessToken, required this.player});

  final String accessToken;
  final Player player;
}

class ApiClient {
  ApiClient(this._store) {
    final baseUrl = '${AppConfig.normalizedApiUrl}/';
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 25),
      sendTimeout: const Duration(seconds: 25),
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      headers: const {'Accept': 'application/json'},
    ));
    _refreshDio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      headers: const {'Accept': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        options.headers['X-ClutchNex-Client'] = 'flutter';
        final accessToken = await _store.readAccessToken();
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }
        if (_usesRefreshCookie(options.path)) {
          final cookie = await _store.readRefreshCookie();
          if (cookie != null && cookie.isNotEmpty) options.headers['Cookie'] = cookie;
        }
        handler.next(options);
      },
      onResponse: (response, handler) async {
        await _captureRefreshCookie(response.headers.map);
        handler.next(response);
      },
      onError: (error, handler) async {
        if (!_shouldRefresh(error)) {
          handler.next(error);
          return;
        }

        final accessToken = await _refreshAccessToken();
        if (accessToken == null) {
          handler.next(error);
          return;
        }

        final request = error.requestOptions;
        request.extra['clutchnex.authRetried'] = true;
        request.headers['Authorization'] = 'Bearer $accessToken';
        try {
          final response = await _dio.fetch<dynamic>(request);
          handler.resolve(response);
        } on DioException catch (retryError) {
          handler.next(retryError);
        } catch (_) {
          handler.next(error);
        }
      },
    ));
  }

  final SessionStore _store;
  late final Dio _dio;
  late final Dio _refreshDio;
  Future<String?>? _refreshTask;

  bool _usesRefreshCookie(String path) =>
      path.endsWith('auth/refresh') || path.endsWith('auth/logout');

  bool _isSessionEndpoint(String path) =>
      path.endsWith('auth/login') ||
      path.endsWith('auth/register') ||
      path.endsWith('auth/refresh') ||
      path.endsWith('auth/logout') ||
      path.endsWith('auth/forgot-password') ||
      path.endsWith('auth/reset-password');

  bool _shouldRefresh(DioException error) {
    final request = error.requestOptions;
    return error.response?.statusCode == 401 &&
        request.extra['clutchnex.authRetried'] != true &&
        !_isSessionEndpoint(request.path) &&
        !request.path.endsWith('auth/change-password');
  }

  Future<void> _captureRefreshCookie(Map<String, List<String>> headers) async {
    final cookies = headers['set-cookie'] ?? headers['Set-Cookie'] ?? const <String>[];
    for (final value in cookies) {
      if (value.startsWith('cn_refresh=;')) {
        await _store.writeRefreshCookie('');
        return;
      }
      if (value.startsWith('cn_refresh=')) {
        await _store.writeRefreshCookie(value.split(';').first.trim());
        return;
      }
    }
  }

  Future<String?> _refreshAccessToken() {
    final running = _refreshTask;
    if (running != null) return running;
    final task = _performRefresh();
    _refreshTask = task;
    return task.whenComplete(() => _refreshTask = null);
  }

  Future<String?> _performRefresh() async {
    final cookie = await _store.readRefreshCookie();
    if (cookie == null || cookie.isEmpty) {
      await _store.expireSession();
      return null;
    }

    try {
      final response = await _refreshDio.post<dynamic>(
        'auth/refresh',
        options: Options(headers: {
          'Cookie': cookie,
          'X-ClutchNex-Client': 'flutter',
        }),
      );
      await _captureRefreshCookie(response.headers.map);
      final body = asJson(response.data);
      final data = asJson(body['data']);
      final token = stringValue(data['accessToken']);
      if (token.isEmpty) {
        await _store.expireSession();
        return null;
      }
      await _store.writeAccessToken(token);
      return token;
    } on DioException {
      await _store.expireSession();
      return null;
    } catch (_) {
      await _store.expireSession();
      return null;
    }
  }

  Object? _unwrap(Object? body) {
    if (body is Map && body.containsKey('data')) return body['data'];
    return body;
  }

  ApiException _exception(DioException error) {
    final body = asJson(error.response?.data);
    final message = stringValue(
      body['message'],
      fallback: error.type == DioExceptionType.connectionTimeout ||
              error.type == DioExceptionType.receiveTimeout ||
              error.type == DioExceptionType.sendTimeout
          ? 'The request timed out. Please try again.'
          : error.type == DioExceptionType.connectionError
              ? 'Could not reach CLUTCHNEX. Check your connection and try again.'
              : 'Something went wrong. Please try again.',
    );
    return ApiException(
      message,
      code: body['code']?.toString(),
      statusCode: error.response?.statusCode,
    );
  }

  Future<Object?> _request(Future<Response<dynamic>> Function() request) async {
    try {
      final response = await request();
      return _unwrap(response.data);
    } on DioException catch (error) {
      throw _exception(error);
    }
  }

  Future<Object?> _get(String path, {Map<String, Object?>? query}) =>
      _request(() => _dio.get<dynamic>(path, queryParameters: query));

  Future<Object?> _post(String path, [Object? body]) =>
      _request(() => _dio.post<dynamic>(path, data: body));

  Future<Object?> _put(String path, [Object? body]) =>
      _request(() => _dio.put<dynamic>(path, data: body));

  Future<Object?> _patch(String path, [Object? body]) =>
      _request(() => _dio.patch<dynamic>(path, data: body));

  Future<JsonMap> homeStats() async => asJson(await _get('public/stats/home'));

  Future<List<Tournament>> tournaments({
    String search = '',
    String? type,
    String? status,
    int limit = 30,
  }) async {
    final query = <String, Object?>{'limit': limit};
    if (search.trim().isNotEmpty) query['search'] = search.trim();
    if (type != null && type.isNotEmpty) query['type'] = type;
    if (status != null && status.isNotEmpty) query['status'] = status;
    final data = asJson(await _get('public/tournaments', query: query));
    return jsonList(data['items']).map(Tournament.fromJson).toList(growable: false);
  }

  Future<JsonMap> tournament(String slug) async =>
      asJson(await _get('public/tournaments/${Uri.encodeComponent(slug)}'));

  Future<JsonMap> leaderboard({String period = 'all'}) async =>
      asJson(await _get('public/leaderboard', query: {'period': period, 'limit': 50}));

  Future<LoginResult> login(String identifier, String password) async {
    final data = asJson(await _post('auth/login', {
      'identifier': identifier.trim(),
      'password': password,
    }));
    return LoginResult(
      accessToken: stringValue(data['accessToken']),
      player: Player.fromJson(data['user']),
    );
  }

  Future<JsonMap> register(JsonMap input) async => asJson(await _post('auth/register', input));

  Future<Player> me() async => Player.fromJson(await _get('auth/me'));

  Future<Player> updateProfile(JsonMap input) async =>
      Player.fromJson(await _put('auth/profile', input));

  Future<void> forgotPassword(String email) async {
    await _post('auth/forgot-password', {'email': email.trim()});
  }

  Future<void> resetPassword({
    required String token,
    required String password,
    required String confirmPassword,
  }) async {
    await _post('auth/reset-password', {
      'token': token,
      'password': password,
      'confirmPassword': confirmPassword,
    });
  }

  Future<void> changePassword({
    required String currentPassword,
    required String password,
    required String confirmPassword,
  }) async {
    await _post('auth/change-password', {
      'currentPassword': currentPassword,
      'password': password,
      'confirmPassword': confirmPassword,
    });
  }

  Future<void> logout() async {
    await _post('auth/logout', {});
  }

  Future<Object?> joinTournament({
    required String slug,
    String? teamId,
    String? freeFireUid,
    String? freeFireIgn,
  }) => _post('tournaments/join', {
        'tournamentSlug': slug,
        if (teamId != null && teamId.isNotEmpty) 'teamId': teamId,
        if (freeFireUid != null && freeFireUid.isNotEmpty) 'freeFireUID': freeFireUid,
        if (freeFireIgn != null && freeFireIgn.isNotEmpty) 'freeFireIGN': freeFireIgn,
      });

  Future<List<JsonMap>> myMatches() async =>
      jsonList(await _get('matches/my'));

  Future<Object?> checkIn(String slug) =>
      _post('tournaments/check-in', {'tournamentSlug': slug});

  Future<WalletSummary> walletOverview() async =>
      WalletSummary.fromJson(await _get('wallet'));

  Future<List<JsonMap>> walletTransactions() async {
    final data = asJson(await _get('wallet/transactions', query: {'page': 1, 'pageSize': 30}));
    return jsonList(data['items']);
  }

  Future<List<JsonMap>> paymentAccounts() async {
    final data = asJson(await _get('wallet/payment-accounts'));
    return jsonList(data['accounts']);
  }

  Future<Object?> submitDeposit({
    required String amount,
    required String method,
    required String transactionId,
    required String senderName,
    String senderAccount = '',
    required String screenshotPath,
  }) async {
    final fileName = screenshotPath.split(RegExp(r'[/\\]')).last;
    final form = FormData.fromMap({
      'amount': amount,
      'method': method,
      'transactionId': transactionId,
      'senderName': senderName,
      'senderAccount': senderAccount,
      'screenshot': await MultipartFile.fromFile(screenshotPath, filename: fileName),
    });
    return _request(() => _dio.post<dynamic>('wallet/deposits', data: form));
  }

  Future<Object?> requestWithdrawal({
    required String amount,
    required String method,
    required String accountName,
    required String accountNumber,
    String accountDetails = '',
    required String requestId,
  }) =>
      _post('wallet/withdrawals', {
        'amount': amount,
        'method': method,
        'accountName': accountName,
        'accountNumber': accountNumber,
        'accountDetails': accountDetails,
        'requestId': requestId,
      });

  Future<Object?> transfer({
    required String recipientUsername,
    required String amount,
    String note = '',
    required String requestId,
  }) =>
      _post('wallet/transfers', {
        'recipientUsername': recipientUsername,
        'amount': amount,
        'note': note,
        'requestId': requestId,
      });

  // The API returns TeamMember rows with `role` and a nested `team` object.
  Future<List<JsonMap>> myTeams() async => jsonList(await _get('teams/my'));

  Future<List<JsonMap>> myTeamInvites() async =>
      jsonList(await _get('teams/invites/my'));

  Future<JsonMap> createTeam({required String name, required String tag, required String type}) async =>
      asJson(await _post('teams', {'name': name, 'tag': tag, 'type': type}));

  Future<JsonMap> joinTeamByCode(String code) async =>
      asJson(await _post('teams/join', {'code': code}));

  Future<JsonMap> teamDetails(String id) async =>
      asJson(await _get('teams/${Uri.encodeComponent(id)}'));

  Future<JsonMap> teamJoinCode(String id) async =>
      asJson(await _get('teams/${Uri.encodeComponent(id)}/join-code'));

  Future<void> inviteToTeam(String id, String username) async {
    await _post('teams/${Uri.encodeComponent(id)}/invite', {'username': username});
  }

  Future<void> respondToTeamInvite(String id, {required bool accept}) async {
    await _post('teams/invites/${Uri.encodeComponent(id)}/${accept ? 'accept' : 'decline'}', {});
  }

  Future<void> leaveTeam(String id) async {
    await _post('teams/${Uri.encodeComponent(id)}/leave', {});
  }

  Future<JsonMap> updateTeam(String id, JsonMap input) async =>
      asJson(await _patch('teams/${Uri.encodeComponent(id)}', input));

  Future<void> removeTeamMember(String id, String userId) async {
    await _post('teams/${Uri.encodeComponent(id)}/remove', {'userId': userId});
  }

  Future<void> transferCaptaincy(String id, String userId) async {
    await _post('teams/${Uri.encodeComponent(id)}/transfer', {'userId': userId});
  }

  Future<List<JsonMap>> notifications() async {
    final data = asJson(await _get('notifications', query: {'page': 1, 'pageSize': 50}));
    return jsonList(data['items']);
  }

  Future<void> markNotificationRead({String? id, bool all = false}) async {
    await _post('notifications/read', {
      if (id != null) 'id': id,
      if (all) 'all': true,
    });
  }

  Future<List<JsonMap>> supportTickets() async {
    final data = asJson(await _get('support', query: {'page': 1, 'pageSize': 30}));
    return jsonList(data['tickets']);
  }

  Future<JsonMap> createSupportTicket({
    required String category,
    required String subject,
    required String priority,
    required String message,
  }) async =>
      asJson(await _post('support', {
        'category': category,
        'subject': subject,
        'priority': priority,
        'message': message,
      }));

  Future<JsonMap> supportThread(String id) async =>
      asJson(await _get('support/${Uri.encodeComponent(id)}'));

  Future<void> replyToSupportTicket(String id, String body) async {
    await _post('support/${Uri.encodeComponent(id)}/reply', {'body': body});
  }

  Future<void> closeSupportTicket(String id) async {
    await _post('support/${Uri.encodeComponent(id)}/close', {});
  }

  Future<JsonMap> askNexa(String message) async =>
      asJson(await _post('nexa', {'message': message}));
}
