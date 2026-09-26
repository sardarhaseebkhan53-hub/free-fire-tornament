class AppConfig {
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'https://www.clutchnex.com/api',
  );

  static const mediaBaseUrl = String.fromEnvironment(
    'MEDIA_BASE_URL',
    defaultValue: 'https://www.clutchnex.com',
  );

  static String get normalizedApiUrl => apiUrl.replaceFirst(RegExp(r'/+$'), '');
  static String get normalizedMediaBaseUrl => mediaBaseUrl.replaceFirst(RegExp(r'/+$'), '');

  static String? mediaUrl(String? path) {
    if (path == null || path.trim().isEmpty) return null;
    final value = path.trim();
    final uri = Uri.tryParse(value);
    if (uri != null && uri.hasScheme) return value;
    return '$normalizedMediaBaseUrl/${value.replaceFirst(RegExp(r'^/+'), '')}';
  }
}
