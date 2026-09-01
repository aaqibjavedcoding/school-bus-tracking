/**
 * Document storage provider abstraction.
 *
 * Defines the contract for storing and retrieving compliance documents.
 * In the current phase, only a local filesystem provider is implemented
 * for development. A production deployment should use a proper object
 * storage solution (S3-compatible, GCS, Azure Blob, etc.).
 *
 * Do not pretend local filesystem storage is a distributed production
 * storage solution. Document future production storage integration separately.
 */

/** Result of a document storage operation. */
export interface StorageResult {
  /** Storage key/path for the stored document. */
  key: string;
  /** Size of the stored document in bytes. */
  size: number;
  /** MIME type of the stored document. */
  contentType: string;
  /** Original filename (sanitized). */
  originalFilename: string;
}

/** Metadata about a stored document. */
export interface StorageMetadata {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  exists: boolean;
}

/**
 * Document storage provider interface.
 *
 * Implementations:
 * - `LocalStorageProvider` — development/local (writes to filesystem)
 *
 * Future: S3-compatible, GCS, Azure Blob, MinIO, etc.
 */
export interface DocumentStorageProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  /**
   * Stores a document.
   *
   * @param buffer - The document content.
   * @param options - Storage options including filename and content type.
   * @returns Storage result with the key for later retrieval.
   */
  store(
    buffer: Buffer,
    options: {
      schoolId: string;
      entityType: string;
      entityId: string;
      filename: string;
      contentType: string;
    },
  ): Promise<StorageResult>;

  /**
   * Retrieves a document.
   *
   * @param key - The storage key returned by `store`.
   * @returns The document content, or null if not found.
   */
  retrieve(key: string): Promise<Buffer | null>;

  /**
   * Gets metadata about a stored document.
   */
  getMetadata(key: string): Promise<StorageMetadata | null>;

  /**
   * Deletes a document.
   *
   * @param key - The storage key.
   * @returns True if the document was deleted, false if it didn't exist.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Generates a temporary signed URL for direct access.
   * Returns null if the provider doesn't support signed URLs.
   */
  getSignedUrl?(key: string, expiresIn?: number): Promise<string | null>;
}
