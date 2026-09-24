// 为 save-targets.mjs 提供类型声明（与 upstream-core / appearance 同一模式）。
export type Provider = "dropbox" | "gdrive" | "onedrive";

export type ProviderLabel = { zh: string; en: string };

export type ProviderSpec = {
  label: ProviderLabel;
  kind: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extraAuthParams?: Record<string, string>;
  consoleUrl: string;
  consoleHint: ProviderLabel;
  upload: {
    url: string | ((filename: string) => string);
    method: string;
    headers: (filename: string) => Record<string, string>;
    multipart?: boolean;
    resultPath: (json: any) => string;
  };
};

export const OAUTH_PROVIDERS: Record<Provider, ProviderSpec>;

export const MANUAL_TARGETS: { id: string; label: ProviderLabel; url: string }[];

export type WebdavConfig = { url?: string; username?: string; password?: string; directory?: string };

export type SaveTargetsConfig = {
  webdav?: WebdavConfig;
  providers?: Partial<Record<Provider, { clientId?: string }>>;
};

export function sanitizeFilename(name: unknown): string;
export function joinWebdavUrl(baseUrl: string, filename: string): string;
export function validateWebdav(cfg: WebdavConfig | undefined): string[];
export function providerStatus(config: SaveTargetsConfig | undefined): Record<
  Provider,
  { label: ProviderLabel; clientId: string; configured: boolean }
>;

export function makeCodeVerifier(len?: number, rnd?: () => number): string;
export function base64Url(buf: Buffer | string): string;
export function makeCodeChallenge(verifier: string, sha256: (s: string) => Buffer): string;
export function makeState(bytes?: number, rnd?: () => number): string;

export function buildAuthorizeUrl(
  provider: Provider,
  p: { clientId: string; redirectUri: string; codeChallenge: string; state: string },
): string;

export function buildTokenParams(
  provider: Provider,
  p: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): string;

export function buildRefreshParams(
  provider: Provider,
  p: { clientId: string; refreshToken: string },
): string;

export function needsRefresh(token: any, nowMs?: number, skewMs?: number): boolean;
export function mergeRefreshed(token: any, resp: any, nowMs?: number): any;
export function buildGdriveMultipart(filename: string, bodyBuf: Buffer, boundary: string): Buffer;
