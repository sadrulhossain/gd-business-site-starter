/** File types are decided by magic bytes, never by the client's content type or file name. */
export type ImageKind = 'jpeg' | 'png' | 'webp' | 'ico';

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

export function detectKind(b: Uint8Array): ImageKind | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  return null;
}

/** Width and height read from the WebP container header (VP8, VP8L or VP8X). Null when the header is not valid. */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (detectKind(b) !== 'webp' || b.length < 30) return null;
  if (ascii(b, 12, 'VP8X')) {
    const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return { width: w, height: h };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const v = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  return null;
}

/** Width and height of a PNG (IHDR) or null. Used for the favicon. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (detectKind(b) !== 'png' || b.length < 24) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
