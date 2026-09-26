import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class NexaScreen extends ConsumerStatefulWidget {
  const NexaScreen({super.key});

  @override
  ConsumerState<NexaScreen> createState() => _NexaScreenState();
}

class _NexaScreenState extends ConsumerState<NexaScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [
    const _ChatMessage(
      text: 'Hey, I’m NEXA. Ask me about tournaments, teams, room access, check-in or wallet rules. I can explain the platform, but I can’t move money or reveal private room credentials.',
      fromPlayer: false,
    ),
  ];
  List<String> _quickReplies = const ['How do I join a tournament?', 'When do room details unlock?', 'How do deposits work?'];
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _ask([String? suggested]) async {
    final message = (suggested ?? _controller.text).trim();
    if (message.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _controller.clear();
      _messages.add(_ChatMessage(text: message, fromPlayer: true));
      _quickReplies = const [];
    });
    _scrollToBottom();
    try {
      final answer = await ref.read(apiClientProvider).askNexa(message);
      if (!mounted) return;
      setState(() {
        _messages.add(_ChatMessage(text: stringValue(answer['reply'], fallback: 'I couldn’t find an answer for that yet.'), fromPlayer: false));
        _quickReplies = (answer['quickReplies'] is List) ? (answer['quickReplies'] as List).map((item) => item.toString()).toList() : const [];
      });
      _scrollToBottom();
    } catch (error) {
      if (mounted) {
        setState(() => _messages.add(_ChatMessage(text: errorMessage(error), fromPlayer: false, isError: true)));
        _scrollToBottom();
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent + 180,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          Container(width: 33, height: 33, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(11)), child: const Icon(Icons.auto_awesome_rounded, color: AppColors.accentSoft, size: 18)),
          const SizedBox(width: 10),
          const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('NEXA assistant', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)), Text('Platform help · read only', style: TextStyle(color: AppColors.muted, fontSize: 10))]),
        ]),
      ),
      body: Column(children: [
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 15),
            itemCount: _messages.length + (_sending ? 1 : 0),
            itemBuilder: (context, index) {
              if (_sending && index == _messages.length) return const _TypingIndicator();
              return _ChatBubble(message: _messages[index]);
            },
          ),
        ),
        if (_quickReplies.isNotEmpty)
          SizedBox(
            height: 42,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              scrollDirection: Axis.horizontal,
              itemCount: _quickReplies.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) => ActionChip(
                label: Text(_quickReplies[index], style: const TextStyle(fontSize: 11)),
                onPressed: _sending ? null : () => _ask(_quickReplies[index]),
                backgroundColor: AppColors.elevated,
                side: const BorderSide(color: AppColors.line),
              ),
            ),
          ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            decoration: const BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.line))),
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(child: TextField(
                controller: _controller,
                minLines: 1,
                maxLines: 4,
                maxLength: 500,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _ask(),
                decoration: const InputDecoration(hintText: 'Ask about the arena…', counterText: '', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
              )),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _sending ? null : () => _ask(), icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.arrow_upward_rounded, size: 18)),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _ChatMessage {
  const _ChatMessage({required this.text, required this.fromPlayer, this.isError = false});

  final String text;
  final bool fromPlayer;
  final bool isError;
}

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({required this.message});
  final _ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final user = message.fromPlayer;
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.84),
        margin: const EdgeInsets.only(bottom: 11),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: message.isError ? AppColors.danger.withValues(alpha: 0.11) : user ? AppColors.accentStrong.withValues(alpha: 0.28) : AppColors.elevated,
          borderRadius: BorderRadius.only(topLeft: const Radius.circular(16), topRight: const Radius.circular(16), bottomLeft: Radius.circular(user ? 16 : 4), bottomRight: Radius.circular(user ? 4 : 16)),
          border: Border.all(color: message.isError ? AppColors.danger.withValues(alpha: 0.3) : user ? AppColors.accent.withValues(alpha: 0.28) : AppColors.line),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!user) ...[
            const Row(children: [Icon(Icons.auto_awesome_rounded, size: 13, color: AppColors.accentSoft), SizedBox(width: 5), Text('NEXA', style: TextStyle(color: AppColors.accentSoft, fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 1))]),
            const SizedBox(height: 7),
          ],
          Text(message.text, style: TextStyle(color: message.isError ? AppColors.danger : AppColors.foreground, fontSize: 13, height: 1.48)),
        ]),
      ),
    );
  }
}

class _TypingIndicator extends StatelessWidget {
  const _TypingIndicator();

  @override
  Widget build(BuildContext context) {
    return const Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: AppPanel(
          padding: EdgeInsets.symmetric(horizontal: 15, vertical: 12),
          borderRadius: 14,
          child: SizedBox(width: 35, height: 12, child: LinearProgressIndicator(minHeight: 2)),
        ),
      ),
    );
  }
}
