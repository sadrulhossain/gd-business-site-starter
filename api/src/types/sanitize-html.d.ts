// Minimal typings for sanitize-html 2.18.2 (@types/sanitize-html is not in docs/VERSIONS.md). Only what src/support/sanitize.ts uses.
declare module 'sanitize-html' {
  namespace sanitizeHtml {
    interface Tag { tagName: string; attribs: Record<string, string> }
    interface IOptions {
      allowedTags?: string[];
      allowedAttributes?: Record<string, string[]>;
      allowedSchemes?: string[];
      allowedSchemesByTag?: Record<string, string[]>;
      allowProtocolRelative?: boolean;
      nonTextTags?: string[];
      disallowedTagsMode?: 'discard' | 'escape' | 'recursiveEscape';
      parser?: { decodeEntities?: boolean };
      transformTags?: Record<string, (tagName: string, attribs: Record<string, string>) => Tag>;
    }
  }
  function sanitizeHtml(html: string, options?: sanitizeHtml.IOptions): string;
  export default sanitizeHtml;
}
