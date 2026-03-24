/**
 * Fetches a URL and returns clean plain-text content + metadata.
 * Uses Node's built-in fetch (Node ≥ 18).
 *
 * All extracted content is returned as plain text and is never rendered
 * as HTML — it is passed directly to an LLM as context.
 */

const MAX_CONTENT_CHARS = 40_000;  // ~10k tokens — enough context for most pages
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB hard cap before text extraction

/**
 * Returns true for hostnames that resolve to private/loopback/link-local addresses,
 * to guard against SSRF.
 */
function isPrivateHost(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true;

  // IPv4: check well-known private and reserved ranges
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 0) return true;                              // 0.0.0.0/8
    if (a === 10) return true;                             // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true;                            // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;               // 169.254.0.0/16 (link-local / metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
    if (a === 192 && b === 168) return true;               // 192.168.0.0/16
    if (a === 198 && b >= 18 && b <= 19) return true;     // 198.18.0.0/15
    if (a >= 224) return true;                             // multicast / reserved
  }

  // Common cloud metadata hostnames
  if (hostname === 'metadata.google.internal' || hostname === 'metadata.internal') return true;

  return false;
}

/**
 * @param {string} url
 * @returns {Promise<{url: string, title: string, description: string, text: string}>}
 */
export async function fetchUrl(url) {
  // Validate scheme — only http and https are permitted
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Fetching private or internal addresses is not allowed');
  }

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

    // Reject oversized responses before reading the body
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large (${contentLength} bytes)`);
    }

    // Stream the body and abort once the size cap is reached
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    html = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        reader.cancel();
        break;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode(); // flush any remaining bytes
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
 * Starts searching for closeStr immediately after openStr, so comment-style
 * delimiters (e.g. <!--) are handled correctly without needing to find a `>`.
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

    parts.push(text.slice(cursor, start));

    // Search for the closing delimiter starting right after the opening string.
    // This correctly handles both tag blocks (<script ...>...</script>) and
    // comment blocks (<!-- ... -->) without needing a separate `>` search.
    const closeStart = textLower.indexOf(closeLower, start + openStr.length);
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
      const codePoint = parseInt(entity.slice(2), 16);
      if (Number.isNaN(codePoint) || codePoint > 0x10ffff) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    }
    if (entity.startsWith('#')) {
      const codePoint = parseInt(entity.slice(1), 10);
      if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

