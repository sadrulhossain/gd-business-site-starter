import { describe, expect, it } from 'vitest';
import { cleanHtml } from '../src/support/sanitize.ts';

/** Hostile payloads (script, handlers, dangerous URI schemes with case/entity/whitespace tricks, SVG/MathML, style, frames, forms, base/meta/link, split tags). */
const hostile: [string, string][] = [
  ['script tag', '<script>alert(1)</script>'],
  ['script with attributes', '<script src="https://evil.test/x.js"></script>'],
  ['upper-case script', '<SCRIPT>alert(1)</SCRIPT>'],
  ['split script', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
  ['img onerror', '<img src=x onerror=alert(1)>'],
  ['img onerror quoted', '<img src="x" onerror="alert(1)">'],
  ['onclick on p', '<p onclick="alert(1)">x</p>'],
  ['onmouseover on a', '<a href="https://a.test" onmouseover="alert(1)">x</a>'],
  ['javascript href', '<a href="javascript:alert(1)">x</a>'],
  ['mixed case javascript', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['entity-encoded javascript', '<a href="&#106;avascript:alert(1)">x</a>'],
  ['hex entity javascript', '<a href="&#x6A;avascript:alert(1)">x</a>'],
  ['tab inside javascript', '<a href="java\tscript:alert(1)">x</a>'],
  ['newline inside javascript', '<a href="java\nscript:alert(1)">x</a>'],
  ['leading space javascript', '<a href=" javascript:alert(1)">x</a>'],
  ['vbscript href', '<a href="vbscript:msgbox(1)">x</a>'],
  ['data html href', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
  ['data img src', '<img src="data:image/svg+xml;base64,PHN2Zy8+">'],
  ['javascript img src', '<img src="javascript:alert(1)">'],
  ['svg onload', '<svg onload="alert(1)"><circle/></svg>'],
  ['svg script', '<svg><script>alert(1)</script></svg>'],
  ['math mutation', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ['style tag', '<style>body{background:url(javascript:alert(1))}</style>'],
  ['style attribute', '<p style="background:url(javascript:alert(1))">x</p>'],
  ['iframe', '<iframe src="https://evil.test"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object', '<object data="https://evil.test/x.swf"></object>'],
  ['embed', '<embed src="https://evil.test/x.swf">'],
  ['form', '<form action="https://evil.test"><input name="x"></form>'],
  ['base tag', '<base href="https://evil.test/">'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
  ['link tag', '<link rel="stylesheet" href="https://evil.test/x.css">'],
  ['textarea breakout', '<textarea></textarea><script>alert(1)</script>'],
  ['comment breakout', '<!--><script>alert(1)</script>-->'],
  ['nested noscript', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
];

const FORBIDDEN = /<script|<style|<iframe|<svg|<math|<object|<embed|<form|<base|<meta|<link|<textarea|\son\w+\s*=|javascript:|vbscript:|data:|style\s*=|srcdoc/i;

describe('cleanHtml', () => {
  it('has a corpus of at least 25 hostile payloads', () => expect(hostile.length).toBeGreaterThanOrEqual(25));

  it.each(hostile)('neutralises %s', (_name, payload) => {
    const out = cleanHtml(payload) ?? '';
    expect(out).not.toMatch(FORBIDDEN);
    // Whatever survives re-cleans to itself (the output is a fixed point, nothing is hiding for a second pass).
    expect(cleanHtml(out) ?? '').toBe(out);
  });

  it('keeps every allowed element and attribute', () => {
    const html = [
      '<p>a<br />b</p><hr />', '<p><strong>s</strong><b>b</b><em>e</em><i>i</i><u>u</u><s>s</s><code>c</code></p>',
      '<pre>p</pre><blockquote>q</blockquote><h2>2</h2><h3>3</h3><h4>4</h4><ul><li>l</li></ul><ol><li>o</li></ol>',
      '<a href="https://example.com" title="t">l</a>', '<img src="https://example.com/a.png" alt="a" width="10" height="20" />',
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>',
    ];
    for (const h of html) expect(cleanHtml(h)).toBe(h);
  });

  it('allows http, https, mailto and tel only', () => {
    for (const ok of ['https://a.test', 'http://a.test', 'mailto:a@b.test', 'tel:+123']) expect(cleanHtml(`<a href="${ok}">x</a>`)).toContain(`href="${ok}"`);
    expect(cleanHtml('<a href="ftp://a.test">x</a>')).not.toContain('href');
    expect(cleanHtml('<a href="//a.test/x">x</a>')).not.toContain('href');
  });

  it('adds rel to target=_blank links, drops other targets and the input rel', () => {
    expect(cleanHtml('<a href="https://a.test" target="_blank">x</a>')).toBe('<a href="https://a.test" target="_blank" rel="noopener noreferrer">x</a>');
    expect(cleanHtml('<a href="https://a.test" target="_top" rel="opener">x</a>')).toBe('<a href="https://a.test">x</a>');
    expect(cleanHtml('<a href="https://a.test" target="_blank" rel="opener">x</a>')).toContain('rel="noopener noreferrer"');
  });

  it('turns blank input into null and removes scripts with their content', () => {
    expect(cleanHtml(null)).toBeNull();
    expect(cleanHtml('')).toBeNull();
    expect(cleanHtml('   \n ')).toBeNull();
    expect(cleanHtml('<p>x</p><script>1</script>')).toBe('<p>x</p>');
  });
});
