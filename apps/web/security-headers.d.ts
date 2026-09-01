/** Type surface of `security-headers.js` (CommonJS, consumed by next.config.js). */
export interface SecurityHeadersOptions {
  isProduction?: boolean;
  frameAncestors?: string;
  extraConnectSrc?: string[];
  extraImgSrc?: string[];
}

export interface HttpHeader {
  key: string;
  value: string;
}

export declare function buildContentSecurityPolicy(options?: SecurityHeadersOptions): string;
export declare function buildSecurityHeaders(options?: SecurityHeadersOptions): HttpHeader[];
