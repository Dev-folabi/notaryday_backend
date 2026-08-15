/** List-style variables whose value is injected as HTML list items (<li>). */
const DEFAULT_LIST_VARS = ['alternative_times'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Heuristic: does the body already contain HTML tags (legacy templates)? */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

function renderParagraph(text: string, listVars: string[]): string {
  // A paragraph that is only a list variable becomes a <ul> — the value
  // (e.g. alternative_times) is injected as <li> items downstream.
  const bareMarker = text.match(/^\{\{([^{}]+)\}\}$/);
  if (bareMarker && listVars.includes(bareMarker[1])) {
    return `<ul>{{${bareMarker[1]}}}</ul>`;
  }
  const html = text
    .split(/(\{\{[^{}]*\}\})/g)
    .map((part) =>
      part.startsWith('{{') && part.endsWith('}}') ? part : escapeHtml(part),
    )
    .join('');
  return `<p>${html.replace(/\n/g, '<br>')}</p>`;
}

/** Convert a plain-text template body into HTML, preserving template markers. */
export function textToHtml(
  text: string,
  listVars: string[] = DEFAULT_LIST_VARS,
): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const out: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length) {
      out.push(renderParagraph(buf.join('\n'), listVars));
      buf = [];
    }
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    const sectionOpen = line.match(/^\{\{#([^{}]+)\}\}$/);
    const sectionClose = line.match(/^\{\{\/([^{}]+)\}\}$/);
    if (sectionOpen) {
      flush();
      out.push(`{{#${sectionOpen[1]}}}`);
      continue;
    }
    if (sectionClose) {
      flush();
      out.push(`{{/${sectionClose[1]}}}`);
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();

  return out.join('');
}
