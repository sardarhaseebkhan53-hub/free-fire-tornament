import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.from});

  final String? from;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signIn(_identifier.text, _password.text);
      if (mounted) context.go(widget.from ?? '/home');
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthFrame(
      eyebrow: 'BACK TO THE ARENA',
      title: 'Welcome back.',
      subtitle: 'Sign in to follow your tournaments, squads and winnings.',
      children: [
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _identifier,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.username],
                autocorrect: false,
                decoration: const InputDecoration(labelText: 'Email or username', prefixIcon: Icon(Icons.alternate_email_rounded)),
                validator: (value) => (value == null || value.trim().length < 3) ? 'Enter your email or username.' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _password,
                obscureText: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                onFieldSubmitted: (_) => _submit(),
                decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline_rounded)),
                validator: (value) => (value == null || value.isEmpty) ? 'Enter your password.' : null,
              ),
            ],
          ),
        ),
        if (_error != null) _InlineError(_error!),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => context.push('/forgot-password'),
            child: const Text('Forgot password?'),
          ),
        ),
        const SizedBox(height: 4),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: _busy ? const _ButtonProgress() : const Text('SIGN IN'),
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('New to CLUTCHNEX? ', style: Theme.of(context).textTheme.bodySmall),
              TextButton(onPressed: () => context.push('/register'), child: const Text('Create account')),
            ],
          ),
        ),
        Center(child: TextButton(onPressed: () => context.go('/home'), child: const Text('Continue as a guest'))),
      ],
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fields = <String, TextEditingController>{
    for (final key in const ['fullName', 'username', 'email', 'phone', 'freeFireUID', 'freeFireIGN', 'password', 'confirmPassword'])
      key: TextEditingController(),
  };
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _required(String? value, String label, {int min = 1}) {
    if (value == null || value.trim().length < min) return '$label must be at least $min characters.';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final input = <String, dynamic>{
        for (final entry in _fields.entries)
          if (entry.value.text.trim().isNotEmpty || const {'fullName', 'username', 'email', 'password', 'confirmPassword'}.contains(entry.key))
            entry.key: entry.value.text.trim(),
      };
      await ref.read(authControllerProvider.notifier).registerAndSignIn(input);
      if (mounted) {
        showAppMessage(context, 'Account created. Welcome to the arena!');
        context.go('/home');
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final values = _fields;
    return _AuthFrame(
      eyebrow: 'CREATE YOUR PLAYER ID',
      title: 'Enter the arena.',
      subtitle: 'One account for tournaments, teams and your player profile.',
      children: [
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: values['fullName'],
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.badge_outlined)),
                validator: (value) => _required(value, 'Full name', min: 3),
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['username'],
                autocorrect: false,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Username', prefixIcon: Icon(Icons.alternate_email_rounded)),
                validator: (value) {
                  final required = _required(value, 'Username', min: 3);
                  if (required != null) return required;
                  return RegExp(r'^[a-zA-Z0-9_]+$').hasMatch(value!.trim()) ? null : 'Use letters, numbers and underscores only.';
                },
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['email'],
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Email address', prefixIcon: Icon(Icons.mail_outline_rounded)),
                validator: (value) => value == null || !value.contains('@') || !value.contains('.') ? 'Enter a valid email address.' : null,
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['phone'],
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Phone number (needed to enter events)', prefixIcon: Icon(Icons.phone_outlined)),
                validator: (value) => value == null || value.trim().isEmpty || isValidPlayerPhone(value) ? null : 'Enter 7–15 digits, optionally starting with +.',
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['freeFireUID'],
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Free Fire UID (optional)', prefixIcon: Icon(Icons.numbers_rounded)),
                validator: (value) => value == null || value.isEmpty || RegExp(r'^\d{6,12}$').hasMatch(value.trim()) ? null : 'UID must be 6–12 digits.',
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['freeFireIGN'],
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'In-game name (optional)', prefixIcon: Icon(Icons.sports_esports_outlined)),
                validator: (value) => value == null || value.isEmpty || (value.trim().length >= 2 && value.trim().length <= 24) ? null : 'Name must be 2–24 characters.',
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['password'],
                obscureText: true,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline_rounded)),
                validator: (value) => _passwordError(value),
              ),
              const SizedBox(height: 11),
              TextFormField(
                controller: values['confirmPassword'],
                obscureText: true,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _submit(),
                decoration: const InputDecoration(labelText: 'Confirm password', prefixIcon: Icon(Icons.lock_reset_rounded)),
                validator: (value) => value != values['password']!.text ? 'Passwords do not match.' : null,
              ),
            ],
          ),
        ),
        if (_error != null) _InlineError(_error!),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: _busy ? const _ButtonProgress() : const Text('CREATE ACCOUNT'),
          ),
        ),
        const SizedBox(height: 16),
        Center(
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Already competing? ', style: Theme.of(context).textTheme.bodySmall),
              TextButton(onPressed: () => context.go('/sign-in'), child: const Text('Sign in')),
            ],
          ),
        ),
      ],
    );
  }

  String? _passwordError(String? value) {
    if (value == null || value.length < 8) return 'Use at least 8 characters.';
    if (!RegExp(r'[a-zA-Z]').hasMatch(value) || !RegExp(r'\d').hasMatch(value)) return 'Include at least one letter and one number.';
    return null;
  }
}

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).forgotPassword(_email.text);
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthFrame(
      eyebrow: 'ACCOUNT RECOVERY',
      title: 'Reset password.',
      subtitle: 'Enter your account email. If it exists, a secure reset link will be sent.',
      children: [
        Form(
          key: _formKey,
          child: TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Email address', prefixIcon: Icon(Icons.mail_outline_rounded)),
            validator: (value) => value == null || !value.contains('@') ? 'Enter a valid email address.' : null,
          ),
        ),
        if (_sent) ...[
          const SizedBox(height: 16),
          const _SuccessMessage('If the account exists, check your email for the secure reset link.'),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => context.push('/reset-password'),
              child: const Text('I have a reset token'),
            ),
          ),
        ],
        if (_error != null) _InlineError(_error!),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: _busy ? const _ButtonProgress() : const Text('SEND RESET LINK'),
          ),
        ),
        Center(child: TextButton(onPressed: () => context.go('/sign-in'), child: const Text('Back to sign in'))),
      ],
    );
  }
}

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({required this.token, super.key});

  final String token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _token = TextEditingController(text: widget.token);
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _done = false;

  @override
  void dispose() {
    _token.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).resetPassword(
            token: _token.text.trim(),
            password: _password.text,
            confirmPassword: _confirm.text,
          );
      if (mounted) setState(() => _done = true);
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthFrame(
      eyebrow: 'SECURE ACCOUNT',
      title: 'Choose a new password.',
      subtitle: 'Reset links expire after a short time for your protection.',
      children: [
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _token,
                decoration: const InputDecoration(labelText: 'Reset token', prefixIcon: Icon(Icons.key_rounded)),
                validator: (value) => value == null || value.trim().length < 16 ? 'Enter the token from your reset email.' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _password,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'New password', prefixIcon: Icon(Icons.lock_outline_rounded)),
                validator: (value) => _passwordResetError(value),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _confirm,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Confirm new password', prefixIcon: Icon(Icons.lock_reset_rounded)),
                validator: (value) => value != _password.text ? 'Passwords do not match.' : null,
              ),
            ],
          ),
        ),
        if (_error != null) _InlineError(_error!),
        if (_done) ...[
          const SizedBox(height: 16),
          const _SuccessMessage('Password updated. Sign in with your new password.'),
        ],
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: _busy ? const _ButtonProgress() : const Text('UPDATE PASSWORD'),
          ),
        ),
        Center(child: TextButton(onPressed: () => context.go('/sign-in'), child: const Text('Go to sign in'))),
      ],
    );
  }

  String? _passwordResetError(String? value) {
    if (value == null || value.length < 8) return 'Use at least 8 characters.';
    if (!RegExp(r'[a-zA-Z]').hasMatch(value) || !RegExp(r'\d').hasMatch(value)) return 'Include a letter and a number.';
    return null;
  }
}

class _AuthFrame extends StatelessWidget {
  const _AuthFrame({required this.eyebrow, required this.title, required this.subtitle, required this.children});

  final String eyebrow;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(builder: (context, constraints) {
          return SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(22, 24, 22, 26 + MediaQuery.viewInsetsOf(context).bottom),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight - 50),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  IconButton(onPressed: () => context.go('/home'), icon: const Icon(Icons.arrow_back_rounded), padding: EdgeInsets.zero),
                  const SizedBox(height: 20),
                  const BrandWordmark(),
                  const SizedBox(height: 38),
                  Text(eyebrow, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.accentSoft)),
                  const SizedBox(height: 12),
                  Text(title, style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 9),
                  Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 27),
                  ...children,
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 15),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.danger.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Text(message, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
    );
  }
}

class _SuccessMessage extends StatelessWidget {
  const _SuccessMessage(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: AppColors.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Text(message, style: const TextStyle(color: AppColors.success, fontSize: 13)),
    );
  }
}

class _ButtonProgress extends StatelessWidget {
  const _ButtonProgress();

  @override
  Widget build(BuildContext context) => const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white));
}
