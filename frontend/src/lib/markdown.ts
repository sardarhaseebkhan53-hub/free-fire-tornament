// =============================================================================
// Markdown → safe HTML.
//
// `marked` passes raw HTML straight through and happily emits
// `href="javascript:…"`, and the rendered string goes into
// dangerouslySetInnerHTML on a PUBLIC page. Admin-authored content is not a
// trust boundary: a stolen staff session (or a bug in the composer) turns into
// stored XSS against every reader. So everything is parsed as markdown first,
// then reduced to an explicit allow-list of tags, attributes and URL schemes.
// =============================================================================
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/** Tags a blog/legal article can legitimately use. No script, style, iframe,
 * form or object — and no event handlers anywhere. */
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup', 'small',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'span', 'div',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'rel', 'target'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan', 'align'],
  th: ['colspan', 'rowspan', 'align', 'scope'],
  col: ['span'],
  code: ['class'],
  pre: ['class'],
  span: ['class'],
  div: ['class'],
};

/** Only these schemes may appear in href/src. No javascript:, data:, vbscript:. */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: {
    img: ['http', 'https'],
    a: ['http', 'https', 'mailto', 'tel'],
  },
  // Relative links and anchors are fine; anything else must match a scheme above.
  allowProtocolRelative: false,
  // Drop the content of dangerous elements rather than keeping it as text.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'template'],
  disallowedTagsMode: 'discard',
  enforceHtmlBoundary: true,
  exclusiveFilter: (frame) => frame.tag === 'script' || frame.tag === 'style',
  transformTags: {
    // External links get no referrer and cannot reach window.opener.
    a: (tagName, attribs) => {
      const isExternal = /^https?:\/\//i.test(attribs.href ?? '');
      return {
        tagName,
        attribs: {
          ...attribs,
          ...(isExternal ? { rel: 'nofollow noopener noreferrer', target: '_blank' } : {}),
        },
      };
    },
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: attribs.loading ?? 'lazy', alt: attribs.alt ?? '' },
    }),
  },
};

/** Render untrusted-in-practice markdown to HTML that is safe to inject. */
export async function renderMarkdownSafe(markdown: string): Promise<string> {
  const rawHtml = await marked.parse(markdown ?? '', { async: true });
  return sanitizeHtml(rawHtml, OPTIONS);
}

/** Exposed for tests: the policy without the markdown step. */
export function sanitizeHtmlString(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
