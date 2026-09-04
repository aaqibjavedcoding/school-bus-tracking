import { Logger } from '../../../framework';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import type {
  DocumentStorageProvider,
  StorageMetadata,
  StorageResult,
} from './document-storage.interface';

/**
 * Allowed file extensions for document uploads.
 */
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
]);

/**
 * Maximum file size: 10 MB.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Local filesystem document storage provider for development.
 *
 * Stores documents under a configurable base directory, organized by
 * school and entity. This is NOT a production storage solution — it
 * exists for local development and testing.
 *
 * Production deployment should use a proper object storage solution
 * (S3-compatible, GCS, Azure Blob, MinIO, etc.).
 */
export class LocalStorageProvider implements DocumentStorageProvider {
  readonly name = 'local-filesystem';
  readonly isConfigured = true;
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? resolve(process.cwd(), '.document-storage');
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  async store(
    buffer: Buffer,
    options: {
      schoolId: string;
      entityType: string;
      entityId: string;
      filename: string;
      contentType: string;
    },
  ): Promise<StorageResult> {
    // Validate file size.
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File size ${buffer.length} exceeds maximum ${MAX_FILE_SIZE}`);
    }

    // Sanitize filename.
    const sanitized = this.sanitizeFilename(options.filename);
    const ext = this.getExtension(sanitized).toLowerCase();

    // Validate file type.
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File type ${ext} is not allowed`);
    }

    // Generate storage key.
    const uniqueId = randomUUID().slice(0, 8);
    const key = `${options.schoolId}/${options.entityType}/${options.entityId}/${uniqueId}-${sanitized}`;

    // Ensure directory exists.
    const fullPath = join(this.basePath, key);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file.
    writeFileSync(fullPath, buffer);

    this.logger.debug(`Stored document: ${key} (${buffer.length} bytes)`);

    return {
      key,
      size: buffer.length,
      contentType: options.contentType,
      originalFilename: sanitized,
    };
  }

  async retrieve(key: string): Promise<Buffer | null> {
    const fullPath = join(this.basePath, key);
    if (!existsSync(fullPath)) {
      return null;
    }
    return readFileSync(fullPath);
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const fullPath = join(this.basePath, key);
    if (!existsSync(fullPath)) {
      return null;
    }
    const stats = statSync(fullPath);
    return {
      key,
      size: stats.size,
      contentType: 'application/octet-stream',
      lastModified: stats.mtime,
      exists: true,
    };
  }

  async delete(key: string): Promise<boolean> {
    const fullPath = join(this.basePath, key);
    if (!existsSync(fullPath)) {
      return false;
    }
    try {
      unlinkSync(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sanitizes a filename to prevent path traversal and special characters.
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '')
      .slice(0, 200);
  }

  /**
   * Extracts the file extension (including the dot).
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot) : '';
  }
}
