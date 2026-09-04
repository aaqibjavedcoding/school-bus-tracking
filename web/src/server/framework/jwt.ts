/**
 * Replacement for `@nestjs/jwt`'s `JwtService`.
 *
 * `@nestjs/jwt` is a thin wrapper around `jsonwebtoken`; this class keeps the
 * exact same constructor shape (`new JwtService({ secret, signOptions })`)
 * and the same method surface used across the codebase — `signAsync`,
 * `verifyAsync`, `decode`, plus the synchronous `sign`/`verify` pair. Existing
 * unit tests construct it directly (`new JwtService({ secret: SECRET })`) and
 * therefore keep working untouched.
 */
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from 'jsonwebtoken';

export interface JwtModuleOptions {
  secret?: string;
  signOptions?: SignOptions;
  verifyOptions?: VerifyOptions;
}

export class JwtService {
  constructor(private readonly options: JwtModuleOptions = {}) {}

  /** Signs a payload, merging per-call options over the configured defaults. */
  sign(payload: string | object, options?: SignOptions): string {
    const secret = this.resolveSecret(options);
    const signOptions = { ...this.options.signOptions, ...options };
    return jwt.sign(payload as object, secret, signOptions);
  }

  async signAsync(payload: string | object, options?: SignOptions): Promise<string> {
    return this.sign(payload, options);
  }

  /**
   * Verifies a token. Throws on an invalid signature, expiry, or malformed
   * token — callers translate that into a 401, exactly as before.
   */
  verify<T = JwtPayload>(token: string, options?: VerifyOptions): T {
    const secret = this.resolveSecret(options as SignOptions | undefined);
    const verifyOptions = { ...this.options.verifyOptions, ...options };
    return jwt.verify(token, secret, verifyOptions) as T;
  }

  async verifyAsync<T = JwtPayload>(token: string, options?: VerifyOptions): Promise<T> {
    return this.verify<T>(token, options);
  }

  /** Decodes without verifying — used only to read `exp`/`iat` for TTL math. */
  decode<T = JwtPayload | null>(token: string): T {
    return jwt.decode(token) as T;
  }

  private resolveSecret(options?: { secret?: string } | SignOptions | VerifyOptions): string {
    const secret = (options as { secret?: string } | undefined)?.secret ?? this.options.secret;
    if (!secret) {
      throw new Error('JwtService requires a secret to sign or verify tokens.');
    }
    return secret;
  }
}
