import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

const _paymentMethods = <(String, String)>[
  ('JAZZCASH', 'JazzCash'),
  ('EASYPAISA', 'EasyPaisa'),
  ('BANK_TRANSFER', 'Bank transfer'),
  ('NAYAPAY', 'NayaPay'),
  ('SADAPAY', 'SadaPay'),
];

String _paymentLabel(String code) {
  for (final entry in _paymentMethods) {
    if (entry.$1 == code) return entry.$2;
  }
  return statusLabel(code);
}

String? _wholePkrAmountError(String? value) {
  final amount = int.tryParse(value ?? '') ?? 0;
  if (amount <= 0) return 'Enter a whole-number amount.';
  if (amount > 1000000) return 'Amount cannot exceed Rs 1,000,000.';
  return null;
}

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My wallet')),
      body: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async { await ref.refresh(walletProvider.future); },
        child: wallet.when(
          loading: () => const LoadingPanel(label: 'Loading your wallet…'),
          error: (error, stack) => ListView(padding: const EdgeInsets.all(20), children: [ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(walletProvider))]),
          data: (summary) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 30),
            children: [
              AppPanel(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
                gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF2A214C), Color(0xFF111829)]),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [const Icon(Icons.account_balance_wallet_outlined, color: AppColors.accentSoft), const SizedBox(width: 8), Text('AVAILABLE BALANCE', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.secondary))]),
                  const SizedBox(height: 12),
                  Text(money(summary.balance), style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 35)),
                  const SizedBox(height: 5),
                  Text('PKR wallet · deposits are credited after manual review', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 18),
                  Row(children: [
                    _PendingChip(icon: Icons.hourglass_top_rounded, label: '${intValue(summary.pending['deposits'])} deposits pending'),
                    const SizedBox(width: 8),
                    _PendingChip(icon: Icons.outbox_rounded, label: '${intValue(summary.pending['withdrawals'])} withdrawals'),
                  ]),
                ]),
              ),
              const SizedBox(height: 15),
              Row(children: [
                Expanded(child: _WalletAction(icon: Icons.add_circle_outline_rounded, label: 'Add funds', onTap: () => context.push('/wallet/deposit'))),
                const SizedBox(width: 9),
                Expanded(child: _WalletAction(icon: Icons.south_west_rounded, label: 'Withdraw', onTap: () => context.push('/wallet/withdraw'))),
                const SizedBox(width: 9),
                Expanded(child: _WalletAction(icon: Icons.swap_horiz_rounded, label: 'Transfer', onTap: () => context.push('/wallet/transfer'))),
              ]),
              const SizedBox(height: 24),
              SectionHeading('Recent activity', action: '${summary.transactions.length} entries'),
              const SizedBox(height: 10),
              if (summary.transactions.isEmpty)
                const EmptyPanel(title: 'No wallet activity yet', message: 'Deposits, tournament entries and winnings will appear here.', icon: Icons.receipt_long_outlined)
              else
                ...summary.transactions.map((transaction) => _TransactionRow(transaction: transaction)),
              const SizedBox(height: 14),
              AppPanel(
                padding: const EdgeInsets.all(14),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.verified_user_outlined, color: AppColors.success, size: 19),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Your balance and payment status are calculated by the CLUTCHNEX server. Never share your password, OTP or payment proof with another player.', style: Theme.of(context).textTheme.bodySmall)),
                ]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class DepositScreen extends ConsumerStatefulWidget {
  const DepositScreen({super.key});

  @override
  ConsumerState<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends ConsumerState<DepositScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _tid = TextEditingController();
  final _sender = TextEditingController();
  final _senderAccount = TextEditingController();
  late Future<List<JsonMap>> _accounts;
  String? _selectedAccount;
  XFile? _proof;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _accounts = ref.read(apiClientProvider).paymentAccounts();
  }

  @override
  void dispose() {
    _amount.dispose();
    _tid.dispose();
    _sender.dispose();
    _senderAccount.dispose();
    super.dispose();
  }

  Future<void> _pickProof() async {
    try {
      final image = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 90);
      if (image != null && mounted) setState(() => _proof = image);
    } catch (error) {
      if (mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _submit(JsonMap account, WalletSummary? wallet) async {
    if (!_formKey.currentState!.validate()) return;
    if (_proof == null) {
      setState(() => _error = 'Choose a screenshot of your payment to continue.');
      return;
    }
    if (wallet == null) {
      setState(() => _error = 'Server deposit limits are unavailable. Refresh your wallet and try again.');
      return;
    }
    final minimum = numberValue(wallet.settings['minDeposit'], fallback: double.nan);
    final maximum = numberValue(wallet.settings['maxDeposit'], fallback: double.nan);
    final parsedAmount = int.tryParse(_amount.text.trim()) ?? 0;
    if (!minimum.isFinite || !maximum.isFinite || minimum < 0 || maximum <= 0 || maximum < minimum) {
      setState(() => _error = 'Server deposit limits are unavailable. Refresh your wallet and try again.');
      return;
    }
    if (parsedAmount < minimum || parsedAmount > maximum) {
      setState(() => _error = 'Deposit amount must be between ${money(minimum)} and ${money(maximum)}.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).submitDeposit(
            amount: '$parsedAmount',
            method: stringValue(account['method']),
            transactionId: _tid.text.trim(),
            senderName: _sender.text.trim(),
            senderAccount: _senderAccount.text.trim(),
            screenshotPath: _proof!.path,
          );
      ref.invalidate(walletProvider);
      ref.invalidate(notificationsProvider);
      if (mounted) {
        showAppMessage(context, 'Payment submitted. Funds are added after admin verification.');
        context.pop();
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final walletState = ref.watch(walletProvider);
    final wallet = walletState.valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Add funds')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 6, 20, 30), children: [
        AppPanel(
          padding: const EdgeInsets.all(15),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.info_outline_rounded, color: AppColors.accentSoft),
            const SizedBox(width: 10),
            Expanded(child: Text('Send your payment to one of the verified accounts below, then submit the transaction ID and screenshot. Your wallet is not credited until staff approves it.', style: Theme.of(context).textTheme.bodySmall)),
          ]),
        ),
        const SizedBox(height: 15),
        FutureBuilder<List<JsonMap>>(
          future: _accounts,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return const LoadingPanel(label: 'Loading payment destinations…');
            if (snapshot.hasError) return ErrorPanel(message: errorMessage(snapshot.error!), onRetry: () => setState(() => _accounts = ref.read(apiClientProvider).paymentAccounts()));
            final accounts = snapshot.data ?? [];
            if (accounts.isEmpty) return const EmptyPanel(title: 'No payment account available', message: 'The platform has not configured a deposit destination yet. Try again later.', icon: Icons.account_balance_outlined);
            final selectedId = accounts.any((account) => account['id'] == _selectedAccount) ? _selectedAccount! : stringValue(accounts.first['id']);
            final selected = accounts.firstWhere((account) => stringValue(account['id']) == selectedId);
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              DropdownButtonFormField<String>(
                value: selectedId,
                decoration: const InputDecoration(labelText: 'Payment account', prefixIcon: Icon(Icons.account_balance_outlined)),
                items: accounts.map((account) => DropdownMenuItem(value: stringValue(account['id']), child: Text('${stringValue(account['label'], fallback: _paymentLabel(stringValue(account['method'])))} · ${_paymentLabel(stringValue(account['method']))}', overflow: TextOverflow.ellipsis))).toList(),
                onChanged: _busy ? null : (value) => setState(() => _selectedAccount = value),
              ),
              const SizedBox(height: 12),
              _PaymentDestination(account: selected),
              if (wallet == null) ...[
                const SizedBox(height: 16),
                walletState.when(
                  loading: () => const LoadingPanel(label: 'Loading server deposit limits…'),
                  error: (error, stack) => ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(walletProvider)),
                  data: (_) => const SizedBox.shrink(),
                ),
              ] else ...[
                const SizedBox(height: 16),
                Form(key: _formKey, child: Column(children: [
                  TextFormField(controller: _amount, enabled: !_busy, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Amount in PKR', helperText: 'Minimum ${money(wallet.settings['minDeposit'])} · Maximum ${money(wallet.settings['maxDeposit'])}', prefixIcon: const Icon(Icons.currency_exchange_rounded)), validator: (value) => _wholePkrAmountError),
                  const SizedBox(height: 11),
                  TextFormField(controller: _tid, enabled: !_busy, maxLength: 64, decoration: const InputDecoration(labelText: 'Transaction ID', prefixIcon: Icon(Icons.tag_rounded)), validator: (value) => value == null || !RegExp(r'^[A-Za-z0-9_-]{4,64}$').hasMatch(value.trim()) ? 'Use 4–64 letters, numbers, hyphens or underscores.' : null),
                  const SizedBox(height: 11),
                  TextFormField(controller: _sender, enabled: !_busy, maxLength: 80, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Sender account name', prefixIcon: Icon(Icons.person_outline_rounded)), validator: (value) => value == null || value.trim().length < 2 || value.trim().length > 80 ? 'Enter a 2–80 character sender name.' : null),
                  const SizedBox(height: 11),
                  TextFormField(controller: _senderAccount, enabled: !_busy, maxLength: 40, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Sender account / number (optional)', prefixIcon: Icon(Icons.phone_outlined))),
                ])),
                const SizedBox(height: 13),
                _ProofPicker(image: _proof, onTap: _busy ? null : _pickProof),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
                const SizedBox(height: 15),
                SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : () => _submit(selected, wallet), child: _busy ? const _ButtonSpinner() : const Text('SUBMIT FOR REVIEW'))),
              ],
            ]);
          },
        ),
      ]),
    );
  }
}

class WithdrawalScreen extends ConsumerStatefulWidget {
  const WithdrawalScreen({super.key});

  @override
  ConsumerState<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends ConsumerState<WithdrawalScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _name = TextEditingController();
  final _number = TextEditingController();
  final _details = TextEditingController();
  String _method = 'JAZZCASH';
  String _requestId = Uuid().v4();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _name.dispose();
    _number.dispose();
    _details.dispose();
    super.dispose();
  }

  String? _validatePayoutAccount(String? value) {
    final account = (value ?? '').replaceAll(RegExp(r'[\s-]'), '');
    if (_method == 'BANK_TRANSFER') {
      return RegExp(r'^[A-Za-z0-9]{8,34}$').hasMatch(account)
          ? null
          : 'Enter an 8–34 character account number or IBAN.';
    }
    return RegExp(r'^03\d{9}$').hasMatch(account)
        ? null
        : 'Enter the 11-digit 03XXXXXXXXX mobile wallet number.';
  }

  Future<void> _submit(WalletSummary wallet) async {
    if (!_formKey.currentState!.validate()) return;
    final amount = int.tryParse(_amount.text.trim()) ?? 0;
    final minimum = numberValue(wallet.settings['minWithdrawal'], fallback: double.nan);
    if (!minimum.isFinite || minimum < 0) {
      setState(() => _error = 'Server withdrawal limits are unavailable. Refresh your wallet and try again.');
      return;
    }
    if (amount < minimum || amount > wallet.withdrawable) {
      setState(() => _error = 'Enter an amount between ${money(minimum)} and your available balance of ${money(wallet.withdrawable)}.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).requestWithdrawal(
            amount: '$amount',
            method: _method,
            accountName: _name.text.trim(),
            accountNumber: _number.text.trim(),
            accountDetails: _details.text.trim(),
            requestId: _requestId,
          );
      ref.invalidate(walletProvider);
      if (mounted) {
        showAppMessage(context, 'Withdrawal request submitted for review.');
        context.pop();
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final walletState = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Withdraw funds')),
      body: walletState.when(
        loading: () => const LoadingPanel(label: 'Checking your wallet…'),
        error: (error, stack) => Padding(padding: const EdgeInsets.all(20), child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(walletProvider))),
        data: (wallet) => ListView(padding: const EdgeInsets.fromLTRB(20, 6, 20, 30), children: [
          AppPanel(
            child: Row(children: [
              const Icon(Icons.account_balance_wallet_outlined, color: AppColors.accentSoft),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Withdrawable balance', style: TextStyle(color: AppColors.muted, fontSize: 11)), const SizedBox(height: 4), Text(money(wallet.withdrawable), style: const TextStyle(color: AppColors.foreground, fontSize: 20, fontWeight: FontWeight.w900))])),
            ]),
          ),
          const SizedBox(height: 15),
          AppPanel(padding: const EdgeInsets.all(14), child: Text('Withdrawals are checked by the CLUTCHNEX team. A request may temporarily reserve the amount while it is reviewed.', style: Theme.of(context).textTheme.bodySmall)),
          const SizedBox(height: 16),
          Form(key: _formKey, child: Column(children: [
            TextFormField(controller: _amount, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Amount in PKR', helperText: 'Minimum ${money(wallet.settings['minWithdrawal'])}', prefixIcon: const Icon(Icons.currency_exchange_rounded)), validator: (value) => _wholePkrAmountError),
            const SizedBox(height: 11),
            DropdownButtonFormField<String>(
              value: _method,
              decoration: const InputDecoration(labelText: 'Payout method', prefixIcon: Icon(Icons.payments_outlined)),
              items: _paymentMethods.map((item) => DropdownMenuItem(value: item.$1, child: Text(item.$2))).toList(),
              onChanged: _busy ? null : (value) => setState(() { _method = value ?? _method; _requestId = Uuid().v4(); }),
            ),
            const SizedBox(height: 11),
            TextFormField(controller: _name, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), maxLength: 80, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Account holder name'), validator: (value) => value == null || value.trim().length < 2 || value.trim().length > 80 ? 'Enter a 2–80 character account holder name.' : null),
            const SizedBox(height: 11),
            TextFormField(controller: _number, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), maxLength: 34, decoration: InputDecoration(labelText: _method == 'BANK_TRANSFER' ? 'Account number / IBAN' : '${_paymentLabel(_method)} mobile number', prefixIcon: const Icon(Icons.numbers_rounded)), validator: _validatePayoutAccount),
            const SizedBox(height: 11),
            TextFormField(controller: _details, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), maxLength: 120, maxLines: 2, decoration: const InputDecoration(labelText: 'Bank / branch details (optional)', alignLabelWithHint: true)),
          ])),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
          const SizedBox(height: 17),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : () => _submit(wallet), child: _busy ? const _ButtonSpinner() : const Text('REQUEST WITHDRAWAL'))),
        ]),
      ),
    );
  }
}

class TransferScreen extends ConsumerStatefulWidget {
  const TransferScreen({super.key});

  @override
  ConsumerState<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends ConsumerState<TransferScreen> {
  final _formKey = GlobalKey<FormState>();
  final _recipient = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _requestId = Uuid().v4();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _recipient.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit(WalletSummary wallet) async {
    if (!_formKey.currentState!.validate()) return;
    final amount = int.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0 || amount > wallet.balance) {
      setState(() => _error = 'Enter an amount up to your available balance of ${money(wallet.balance)}.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).transfer(
            recipientUsername: _recipient.text.trim().toLowerCase(),
            amount: '$amount',
            note: _note.text.trim(),
            requestId: _requestId,
          );
      ref.invalidate(walletProvider);
      if (mounted) {
        showAppMessage(context, 'Transfer completed securely.');
        context.pop();
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Send a transfer')),
      body: wallet.when(
        loading: () => const LoadingPanel(label: 'Checking your balance…'),
        error: (error, stack) => Padding(padding: const EdgeInsets.all(20), child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(walletProvider))),
        data: (summary) => ListView(padding: const EdgeInsets.fromLTRB(20, 6, 20, 30), children: [
          AppPanel(
            padding: const EdgeInsets.all(15),
            child: Row(children: [
              const Icon(Icons.swap_horiz_rounded, color: AppColors.accentSoft),
              const SizedBox(width: 10),
              Expanded(child: Text('Available to send · ${money(summary.balance)}', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800))),
            ]),
          ),
          const SizedBox(height: 15),
          AppPanel(padding: const EdgeInsets.all(14), child: Text('Transfers move real funds immediately. Double-check the recipient username. Requests are idempotent and are recorded in your wallet ledger.', style: Theme.of(context).textTheme.bodySmall)),
          const SizedBox(height: 16),
          Form(key: _formKey, child: Column(children: [
            TextFormField(controller: _recipient, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), maxLength: 30, autocorrect: false, decoration: const InputDecoration(labelText: 'Recipient username', prefixIcon: Icon(Icons.person_search_outlined)), validator: (value) => value == null || value.trim().length < 3 ? 'Enter a username with at least 3 characters.' : null),
            const SizedBox(height: 11),
            TextFormField(controller: _amount, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount in PKR', prefixIcon: Icon(Icons.currency_exchange_rounded)), validator: (value) => _wholePkrAmountError),
            const SizedBox(height: 11),
            TextFormField(controller: _note, enabled: !_busy, onChanged: (_) => _requestId = Uuid().v4(), maxLength: 140, maxLines: 2, decoration: const InputDecoration(labelText: 'Note (optional)', alignLabelWithHint: true)),
          ])),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
          const SizedBox(height: 17),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : () => _submit(summary), child: _busy ? const _ButtonSpinner() : const Text('SEND SECURELY'))),
        ]),
      ),
    );
  }
}

class _PaymentDestination extends StatelessWidget {
  const _PaymentDestination({required this.account});
  final JsonMap account;

  @override
  Widget build(BuildContext context) {
    final extra = asJson(account['extra']);
    return AppPanel(
      padding: const EdgeInsets.all(15),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [const Icon(Icons.verified_rounded, size: 17, color: AppColors.success), const SizedBox(width: 7), Expanded(child: Text(stringValue(account['label'], fallback: _paymentLabel(stringValue(account['method']))), style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800))), StatusPill(_paymentLabel(stringValue(account['method'])))]),
        const SizedBox(height: 13),
        _CopyValue(label: 'ACCOUNT NAME', value: stringValue(account['accountName'])),
        const SizedBox(height: 8),
        _CopyValue(label: 'ACCOUNT / NUMBER', value: stringValue(account['accountNumber'])),
        if (extra.isNotEmpty) ...[
          const SizedBox(height: 7),
          ...extra.entries.where((entry) => entry.value != null && entry.value.toString().isNotEmpty).map((entry) => _CopyValue(label: entry.key.replaceAll('_', ' ').toUpperCase(), value: entry.value.toString())),
        ],
        if (stringValue(account['instructions']).isNotEmpty) ...[
          const SizedBox(height: 11),
          Text(stringValue(account['instructions']), style: Theme.of(context).textTheme.bodySmall),
        ],
      ]),
    );
  }
}

class _CopyValue extends StatelessWidget {
  const _CopyValue({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 8, fontWeight: FontWeight.w900, letterSpacing: 0.8)),
        const SizedBox(height: 3),
        Text(value.isEmpty ? 'Not supplied' : value, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 13)),
      ])),
      IconButton(
        visualDensity: VisualDensity.compact,
        onPressed: value.isEmpty ? null : () async {
          await Clipboard.setData(ClipboardData(text: value));
          if (context.mounted) showAppMessage(context, '$label copied.');
        },
        icon: const Icon(Icons.copy_rounded, size: 16, color: AppColors.accentSoft),
      ),
    ]);
  }
}

class _ProofPicker extends StatelessWidget {
  const _ProofPicker({required this.image, required this.onTap});
  final XFile? image;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.elevated, borderRadius: BorderRadius.circular(15), border: Border.all(color: image == null ? AppColors.line : AppColors.success.withValues(alpha: 0.5))),
        child: Row(children: [
          if (image == null)
            Container(width: 42, height: 42, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.add_photo_alternate_outlined, color: AppColors.accentSoft))
          else
            ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(File(image!.path), width: 42, height: 42, fit: BoxFit.cover)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(image == null ? 'Add payment screenshot' : 'Screenshot attached', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 3),
            Text(image == null ? 'JPG or PNG · Required for manual review' : 'Tap to replace the selected proof', style: Theme.of(context).textTheme.bodySmall),
          ])),
          const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
        ]),
      ),
    );
  }
}

class _WalletAction extends StatelessWidget {
  const _WalletAction({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 13),
        borderRadius: 15,
        child: Column(children: [Icon(icon, color: AppColors.accentSoft, size: 21), const SizedBox(height: 7), Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 10))]),
      ),
    );
  }
}

class _PendingChip extends StatelessWidget {
  const _PendingChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Container(padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8), decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(10)), child: Row(children: [Icon(icon, color: AppColors.accentSoft, size: 14), const SizedBox(width: 6), Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.secondary, fontSize: 9, fontWeight: FontWeight.w700)))])));
  }
}

class _TransactionRow extends StatelessWidget {
  const _TransactionRow({required this.transaction});
  final JsonMap transaction;

  @override
  Widget build(BuildContext context) {
    final debit = stringValue(transaction['direction']) == 'DEBIT';
    final amount = numberValue(transaction['amount']);
    final tint = debit ? AppColors.danger : AppColors.success;
    final title = stringValue(transaction['description'], fallback: statusLabel(stringValue(transaction['type'], fallback: 'Wallet activity')));
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
        borderRadius: 14,
        child: Row(children: [
          Container(width: 35, height: 35, decoration: BoxDecoration(color: tint.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(11)), child: Icon(debit ? Icons.south_west_rounded : Icons.north_east_rounded, color: tint, size: 18)),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontSize: 12, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            Text(dateLabel(transaction['createdAt'], pattern: 'd MMM · h:mm a'), style: Theme.of(context).textTheme.bodySmall),
          ])),
          const SizedBox(width: 8),
          Text('${debit ? '−' : '+'}${money(amount)}', style: TextStyle(color: tint, fontWeight: FontWeight.w900, fontSize: 12)),
        ]),
      ),
    );
  }
}

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();
  @override
  Widget build(BuildContext context) => const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white));
}
