/**
 * Fetches a URL and returns clean plain-text content + metadata.
 * Uses Node's built-in fetch (Node ≥ 18).
 *
 * All extracted content is returned as plain text and is never rendered
 * as HTML — it is passed directly to an LLM as context.
 */

const MAX_CONTENT_CHARS = 40_000; // ~10k tokens — enough context for most pages

/**
 * @param {string} url
 * @returns {Promise<{url: string, title: string, description: string, text: string}>}
 */
export async function fetchUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let html;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Skillerizer/1.0; +https://github.com/skullzarmy/skillerizer)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  return {
    url,
    title: extractTitle(html),
    description: extractMeta(html, 'description'),
    text: extractText(html),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : 'Untitled';
}

function extractMeta(html, name) {
  const m =
    html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
  return m ? decodeHtmlEntities(m[1]) : '';
}

function extractText(html) {
  // Extract plain text from HTML for LLM context.
  // Output is NEVER rendered as HTML — it is only passed to an LLM as a plain-text string.
  // We use character-position–based extraction to robustly remove non-text blocks.
  let text = stripBlocks(html, '<script', '</script>');
  text = stripBlocks(text, '<style', '</style>');
  text = stripBlocks(text, '<noscript', '</noscript>');
  text = stripBlocks(text, '<!--', '-->');
  text = stripBlocks(text, '<!--', '--!>'); // legacy IE comment variant

  // Convert block elements to newlines, then remove all tags.
  // Use /s (dotAll) on the final tag-stripper to handle attributes with newlines.
  return text
    .replace(/<(?:br|hr|p|div|section|article|header|footer|h[1-6]|li|tr|td|th)(?:\s[^>]*)?>|<\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|td|th)>/gi, '\n')
    .replace(/<[^>]*>/gs, '')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_CONTENT_CHARS);
}

/**
 * Remove all content between `openStr` and `closeStr` delimiters (case-insensitive).
 * Uses index-based scanning rather than regex on the full string to be robust
 * against multiline or malformed tags.
 */
function stripBlocks(text, openStr, closeStr) {
  const openLower = openStr.toLowerCase();
  const closeLower = closeStr.toLowerCase();
  const textLower = text.toLowerCase();
  const parts = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = textLower.indexOf(openLower, cursor);
    if (start === -1) { parts.push(text.slice(cursor)); break; }

    // Find the > that ends the opening tag (handles attributes)
    const tagEnd = text.indexOf('>', start);
    if (tagEnd === -1) { parts.push(text.slice(cursor)); break; }

    parts.push(text.slice(cursor, start));

    const closeStart = textLower.indexOf(closeLower, tagEnd + 1);
    if (closeStart === -1) { break; } // unclosed block — discard remainder

    cursor = closeStart + closeStr.length;
  }

  return parts.join('');
}

/**
 * Decode HTML entities to their plain-text equivalents.
 * Single-pass via a lookup map to avoid any chained replacement issues.
 * Output is plain text — not for HTML rendering.
 */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  hellip: '…', bull: '•', middot: '·',
};

function decodeHtmlEntities(str) {
  return str.replace(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number(entity.slice(1)));
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

