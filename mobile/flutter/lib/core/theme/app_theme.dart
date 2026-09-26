import 'package:flutter/material.dart';

abstract final class AppColors {
  static const base = Color(0xFF070A14);
  static const surface = Color(0xFF0D1220);
  static const elevated = Color(0xFF131A2E);
  static const panel = Color(0xFF10172A);
  static const accent = Color(0xFF8B5CF6);
  static const accentStrong = Color(0xFF7C3AED);
  static const accentSoft = Color(0xFFB79CFF);
  static const foreground = Color(0xFFF4F6FB);
  static const secondary = Color(0xFFC0C8D9);
  static const muted = Color(0xFF8994AB);
  static const line = Color(0x1FFFFFFF);
  static const success = Color(0xFF10B981);
  static const reward = Color(0xFFF5B942);
  static const danger = Color(0xFFEF5A6F);
  static const info = Color(0xFF54A7FF);
}

ThemeData buildAppTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.accent,
    brightness: Brightness.dark,
  ).copyWith(
    primary: AppColors.accent,
    onPrimary: Colors.white,
    secondary: AppColors.accentSoft,
    surface: AppColors.surface,
    error: AppColors.danger,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.base,
    canvasColor: AppColors.base,
    dividerColor: AppColors.line,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.base,
      foregroundColor: AppColors.foreground,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: AppColors.foreground,
        fontSize: 18,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(fontSize: 34, height: 1.06, fontWeight: FontWeight.w800, letterSpacing: -1.4),
      headlineMedium: TextStyle(fontSize: 28, height: 1.12, fontWeight: FontWeight.w800, letterSpacing: -0.9),
      headlineSmall: TextStyle(fontSize: 23, height: 1.18, fontWeight: FontWeight.w700, letterSpacing: -0.5),
      titleLarge: TextStyle(fontSize: 19, height: 1.25, fontWeight: FontWeight.w700, letterSpacing: -0.3),
      titleMedium: TextStyle(fontSize: 16, height: 1.25, fontWeight: FontWeight.w700),
      bodyLarge: TextStyle(fontSize: 15, height: 1.5, color: AppColors.secondary),
      bodyMedium: TextStyle(fontSize: 14, height: 1.45, color: AppColors.secondary),
      bodySmall: TextStyle(fontSize: 12, height: 1.4, color: AppColors.muted),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 0.1),
      labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 1.2),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.elevated,
      hintStyle: const TextStyle(color: AppColors.muted, fontSize: 14),
      labelStyle: const TextStyle(color: AppColors.secondary),
      prefixIconColor: AppColors.muted,
      suffixIconColor: AppColors.muted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.danger),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(48, 52),
        foregroundColor: Colors.white,
        backgroundColor: AppColors.accentStrong,
        disabledBackgroundColor: AppColors.accentStrong.withValues(alpha: 0.5),
        disabledForegroundColor: Colors.white70,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 0.1),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 50),
        foregroundColor: AppColors.foreground,
        side: const BorderSide(color: AppColors.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: AppColors.accentSoft),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.elevated,
      contentTextStyle: const TextStyle(color: AppColors.foreground),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.accent.withValues(alpha: 0.18),
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          )),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.accent),
  );
}
