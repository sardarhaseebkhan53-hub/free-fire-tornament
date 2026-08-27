// =============================================================================
// The blog/legal markdown sanitizer. These pages inject rendered HTML into a
// PUBLIC page, so every case here is a real injection attempt, not a style
// preference. Admin-authored content is not a trust boundary.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { renderMarkdownSafe, sanitizeHtmlString } from './markdown';

describe('renderMarkdownSafe — script injection', () => {
  it('strips an inline <script>', async () => {
    const out = await renderMarkdownSafe('Hello\n\n<script>alert(document.domain)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(document.domain)');
    expect(out).toContain('Hello');
  });

  it('strips an event handler on an image', async () => {
    const out = await renderMarkdownSafe('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('strips iframe, object, embed, form and style', async () => {
    const out = await renderMarkdownSafe(
      '<iframe src="https://evil.test"></iframe><object data="x"></object>' +
        '<embed src="y"><form action="https://evil.test"><input></form><style>body{display:none}</style>',
    );
    for (const tag of ['<iframe', '<object', '<embed', '<form', '<style']) {
      expect(out).not.toContain(tag);
    }
  });

  it('strips svg-based handlers', async () => {
    const out = await renderMarkdownSafe('<svg onload="alert(1)"><circle r="9"/></svg>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('<svg');
  });

  it('strips a meta refresh', async () => {
    const out = await renderMarkdownSafe('<meta http-equiv="refresh" content="0;url=https://evil.test">');
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('evil.test');
  });
});

describe('renderMarkdownSafe — dangerous URLs', () => {
  it('refuses a javascript: link', async () => {
    const out = await renderMarkdownSafe('[click me](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
  });

  it('refuses an obfuscated javascript: link', async () => {
    const out = await renderMarkdownSafe('[x](JaVaScRiPt:alert(1))');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('refuses a javascript: image source', async () => {
    const out = await renderMarkdownSafe('![img](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
  });

  it('refuses data: URLs', async () => {
    const out = await renderMarkdownSafe('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
    expect(out).not.toContain('data:text/html');
  });

  it('keeps ordinary https, mailto and relative links', async () => {
    const out = await renderMarkdownSafe(
      '[site](https://example.com) [mail](mailto:hi@example.com) [about](/about) [anchor](#rules)',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('href="mailto:hi@example.com"');
    expect(out).toContain('href="/about"');
    expect(out).toContain('href="#rules"');
  });

  it('adds rel/target hardening to external links', async () => {
    const out = await renderMarkdownSafe('[site](https://example.com)');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe('renderMarkdownSafe — legitimate markdown still works', () => {
  it('renders headings, emphasis, lists, code and tables', async () => {
    const out = await renderMarkdownSafe(
      [
        '# Title',
        '',
        'Some **bold** and *italic* text with `code`.',
        '',
        '- one',
        '- two',
        '',
        '> a quote',
        '',
        '```',
        'const x = 1;',
        '```',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
      ].join('\n'),
    );
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>1</td>');
  });

  it('renders an ordinary image with alt text and lazy loading', async () => {
    const out = await renderMarkdownSafe('![banner](https://cdn.example.com/a.png)');
    expect(out).toContain('src="https://cdn.example.com/a.png"');
    expect(out).toContain('alt="banner"');
    expect(out).toContain('loading="lazy"');
  });

  it('keeps harmless inline formatting a writer typed as HTML', async () => {
    // <b>/<i>/<strong> are on the allow-list, so they render — that is safe.
    const out = await renderMarkdownSafe('My clan is <b>the best</b> & we win');
    expect(out).toContain('<b>the best</b>');
    expect(out).toContain('&amp;'); // the bare ampersand is escaped
  });

  it('drops anything not on the allow-list instead of rendering it', async () => {
    const out = await renderMarkdownSafe('hi <marquee>wee</marquee> <blink>there</blink>');
    expect(out).toContain('hi');
    expect(out).not.toContain('<marquee');
    expect(out).not.toContain('<blink');
  });

  it('handles empty and undefined-ish input without throwing', async () => {
    await expect(renderMarkdownSafe('')).resolves.toBe('');
    await expect(renderMarkdownSafe(undefined as never)).resolves.toBe('');
  });
});

describe('sanitizeHtmlString — the policy without the markdown step', () => {
  it('removes tags that are not on the allow-list', () => {
    const out = sanitizeHtmlString('<p>ok</p><script>bad()</script><marquee>no</marquee>');
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<marquee');
  });

  it('removes every on* attribute but keeps href', () => {
    const out = sanitizeHtmlString(
      '<a href="https://example.com" onclick="steal()" onmouseover="steal()">x</a>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
  });
});
