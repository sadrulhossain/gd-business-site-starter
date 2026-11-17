import { Readable } from 'node:stream';
import type { Request } from 'express';
import { HttpError } from '../errors.ts';

/**
 * Reads a multipart body through the Web Request API (works on Node and on workerd). The declared
 * Content-Length is checked before any byte is read, and the stream is cut as soon as it passes the cap.
 */
export async function readForm(req: Request, maxBytes: number): Promise<FormData> {
  const type = req.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) throw new HttpError(415, 'unsupported_media_type', 'Send multipart/form-data.');
  const declared = Number(req.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'The upload is too large.');

  let seen = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) controller.error(new HttpError(413, 'payload_too_large', 'The upload is too large.'));
      else controller.enqueue(chunk);
    },
  });
  const body = (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>).pipeThrough(limit);
  const web = new Request('http://localhost/', { method: 'POST', headers: { 'content-type': type }, body, duplex: 'half' } as RequestInit);
  try {
    return await web.formData();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (seen > maxBytes) throw new HttpError(413, 'payload_too_large', 'The upload is too large.');
    throw new HttpError(400, 'bad_request', 'Malformed multipart body.');
  }
}
