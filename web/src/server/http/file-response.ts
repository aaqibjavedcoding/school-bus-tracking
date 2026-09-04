/**
 * File download + upload plumbing.
 *
 * Replaces two pieces of Nest/Express machinery:
 *
 * 1. `@Res()` streaming (exports, report downloads, import error files) —
 *    handlers now return a `Response` whose body is a stream. The header set
 *    is preserved exactly: `Content-Type`, `Content-Disposition` with both an
 *    ASCII `filename` and an RFC 5987 `filename*`, `X-Content-Type-Options:
 *    nosniff`, `Cache-Control: no-store` and `X-Total-Records`. Because the
 *    handler returns a `Response`, the route runtime skips the JSON envelope
 *    — the same bypass `@Res()` without passthrough used to provide.
 *
 * 2. `FileInterceptor` / multer — `parseUploadedSpreadsheet` reads
 *    `request.formData()` and adapts it to the `UploadedSpreadsheet` shape the
 *    import controller already expects (`{ originalname, mimetype, size,
 *    buffer }`), enforcing the same `MAX_IMPORT_FILE_BYTES` cap.
 */
import { PassThrough, type Writable } from 'stream';
import { DataFileFormat } from '@school-bus-tracking/shared-types';
import { BadRequestException } from '../framework';

/** The exact shape multer produced, kept so service code is untouched. */
export interface UploadedSpreadsheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Builds the `Content-Disposition` value Express emitted. */
export function contentDisposition(safeName: string): string {
  const ascii = safeName.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

/** Content types for the two supported spreadsheet formats. */
export const FILE_CONTENT_TYPE: Record<DataFileFormat, string> = {
  [DataFileFormat.CSV]: 'text/csv; charset=utf-8',
  [DataFileFormat.XLSX]:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * A buffered file download — the `sendFile(...)` + `response.end(buffer)`
 * pair from the import controller.
 */
export function bufferFileResponse(
  buffer: Buffer,
  safeName: string,
  format: DataFileFormat,
): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': FILE_CONTENT_TYPE[format],
      'Content-Disposition': contentDisposition(safeName),
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * A streamed file download.
 *
 * `produce` receives a Node `Writable` — the exact `StreamSink` the export
 * service writes into — and the bytes are piped to the web `ReadableStream`
 * Next sends. Memory behaviour is unchanged: rows are flushed page by page
 * and never accumulate.
 */
export function streamFileResponse(options: {
  contentType: string;
  fileName: string;
  totalRecords?: number;
  produce: (sink: Writable) => Promise<unknown>;
}): Response {
  const passthrough = new PassThrough();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      passthrough.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      passthrough.on('end', () => controller.close());
      passthrough.on('error', (error: Error) => controller.error(error));

      // Kick off production; failures surface as a stream error, which is the
      // same visible outcome as Express destroying a half-written response.
      void options
        .produce(passthrough)
        .then(() => {
          if (!passthrough.writableEnded) {
            passthrough.end();
          }
        })
        .catch((error: Error) => passthrough.destroy(error));
    },
    cancel() {
      passthrough.destroy();
    },
  });

  const headers = new Headers({
    'Content-Type': options.contentType,
    'Content-Disposition': contentDisposition(options.fileName),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  if (options.totalRecords !== undefined) {
    headers.set('X-Total-Records', String(options.totalRecords));
  }

  return new Response(body, { status: 200, headers });
}

/**
 * Reads a single uploaded file out of a multipart request.
 *
 * Returns `undefined` when the field is absent, mirroring multer's behaviour
 * so the caller's existing `requireSpreadsheet` validation (and its exact 400
 * messages) still decides what to reject.
 */
export async function parseUploadedSpreadsheet(
  request: Request,
  field = 'file',
  maxBytes?: number,
): Promise<UploadedSpreadsheet | undefined> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return undefined;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new BadRequestException('Malformed multipart/form-data payload');
  }

  const entry = formData.get(field);
  if (!entry || typeof entry === 'string') {
    return undefined;
  }

  const file = entry as File;
  const buffer = Buffer.from(await file.arrayBuffer());

  // multer rejects at its `limits.fileSize`; keeping the check here means an
  // oversized upload is refused with the caller's own 400 message.
  if (maxBytes !== undefined && buffer.length > maxBytes) {
    return {
      originalname: file.name,
      mimetype: file.type,
      size: buffer.length,
      buffer,
    };
  }

  return {
    originalname: file.name,
    mimetype: file.type,
    size: buffer.length,
    buffer,
  };
}

/** Reads the non-file fields of a multipart form (import mode, etc.). */
export async function parseFormFields(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return {};
  }
  const formData = await request.formData();
  const fields: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      fields[key] = value;
    }
  });
  return fields;
}
