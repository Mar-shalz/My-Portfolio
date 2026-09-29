// Tiny, safe text helpers used by the renderer.
// Content is always HTML-escaped first; only a small markdown subset is re-introduced.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Only allow http(s), mailto, tel, same-site paths and in-page anchors.
export function safeUrl(u = '') {
  u = String(u ?? '').trim();
  if (!u) return '';
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  if (u.startsWith('#')) return u;
  return '';
}

export const isExternal = (u = '') => /^https?:/i.test(u);

// Inline markdown: **bold**, *accent/italic*, [text](url), single newlines -> <br>.
export function inline(s = '') {
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, raw) => {
    const url = safeUrl(raw.replace(/&amp;/g, '&'));
    if (!url) return text;
    const ext = isExternal(url) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${esc(url)}"${ext}>${text}</a>`;
  });
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>');
  return h.replace(/\n/g, '<br>');
}

// Block markdown: blank line = new paragraph, lines starting with "- " = bullet list.
export function md(s = '') {
  const text = String(s ?? '').trim();
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((chunk) => {
      const lines = chunk.split('\n');
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(chunk)}</p>`;
    })
    .join('');
}

// Strip markdown markers for <title>, meta descriptions and alt text.
export const plain = (s = '') =>
  String(s ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const slugify = (s = '') =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
