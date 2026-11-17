import sanitizeHtml from 'sanitize-html';

/** Legacy HtmlSanitizer allow-list (HTMLPurifier HTML.Allowed), implemented with sanitize-html (ADR 013). */
const options: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  // rel is only ever set by the transform below (the input's own rel is dropped there).
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
  // Content of these is dropped with the tag; everything else unknown is unwrapped to its text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'math'],
  disallowedTagsMode: 'discard',
  parser: { decodeEntities: true },
  transformTags: {
    a: (tag, attribs) => {
      // Only target=_blank is allowed; it always carries rel="noopener noreferrer".
      const { target, rel: _rel, ...rest } = attribs;
      void _rel;
      return target === '_blank' ? { tagName: tag, attribs: { ...rest, target: '_blank', rel: 'noopener noreferrer' } } : { tagName: tag, attribs: rest };
    },
  },
};

/** Cleans rich-text HTML on write. Empty or whitespace-only input becomes null, as in legacy. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (html === null || html === undefined || html.trim() === '') return null;
  return sanitizeHtml(html, options);
}
