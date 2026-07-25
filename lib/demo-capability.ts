export type DemoCapabilityAction = "anthropic" | "elevenlabs" | "twilio";

export const DEFAULT_CAPABILITY_TTL_SECONDS = 60;
const MAX_CAPABILITY_TOKEN_LENGTH = 2_048;
const CAPABILITY_VERSION = 1;
const SECRET_STORE_SYMBOL = Symbol.for("carerelay.demo-capability-secret");
const NONCE_STORE_SYMBOL = Symbol.for("carerelay.demo-capability-nonces");

interface CapabilityPayload {
  v: 1;
  a: DemoCapabilityAction;
  iat: number;
  exp: number;
  n: string;
  c: string;
}

interface NonceStore {
  consumed: Map<string, number>;
}

function environmentValue(name: string): string {
  if (typeof process === "undefined") return "";
  return process.env[name]?.trim() ?? "";
}

export function isProductionRuntime(): boolean {
  return environmentValue("NODE_ENV").toLowerCase() === "production";
}

function ephemeralSecret(): Uint8Array {
  const target = globalThis as typeof globalThis & {
    [SECRET_STORE_SYMBOL]?: Uint8Array;
  };
  if (!target[SECRET_STORE_SYMBOL]) {
    target[SECRET_STORE_SYMBOL] = crypto.getRandomValues(new Uint8Array(32));
  }
  return target[SECRET_STORE_SYMBOL];
}

function capabilitySecret(): Uint8Array | undefined {
  const configured = environmentValue("CARERELAY_DEMO_CAPABILITY_SECRET");
  if (configured.length >= 32) {
    return new TextEncoder().encode(configured);
  }
  return isProductionRuntime() ? undefined : ephemeralSecret();
}

export function isDemoCapabilityConfigured(): boolean {
  return capabilitySecret() !== undefined;
}

function nonceStore(): NonceStore {
  const target = globalThis as typeof globalThis & {
    [NONCE_STORE_SYMBOL]?: NonceStore;
  };
  target[NONCE_STORE_SYMBOL] ??= { consumed: new Map() };
  return target[NONCE_STORE_SYMBOL];
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function signingKey(
  usage: "sign" | "verify",
): Promise<CryptoKey | undefined> {
  const secret = capabilitySecret();
  if (!secret) return undefined;
  return crypto.subtle.importKey(
    "raw",
    copiedArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function safeHeaderPart(value: string | null, maximum: number): string {
  if (!value) return "";
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .trim();
  return clean.slice(0, maximum);
}

export async function demoClientBinding(request: Request): Promise<string> {
  const url = new URL(request.url);
  const connectingIp = safeHeaderPart(
    request.headers.get("cf-connecting-ip"),
    64,
  );
  const userAgent = safeHeaderPart(request.headers.get("user-agent"), 256);
  const identity = JSON.stringify({
    origin: url.origin,
    network: connectingIp || "unattributed",
    userAgent: userAgent || "unattributed",
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return base64UrlEncode(new Uint8Array(digest)).slice(0, 32);
}

async function sign(encodedPayload: string): Promise<string | undefined> {
  const key = await signingKey("sign");
  if (!key) return undefined;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export async function issueDemoCapability(
  request: Request,
  action: DemoCapabilityAction,
  {
    now = Date.now(),
    ttlSeconds = DEFAULT_CAPABILITY_TTL_SECONDS,
  }: { now?: number; ttlSeconds?: number } = {},
): Promise<{ token: string; expiresInSeconds: number } | undefined> {
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 10 ||
    ttlSeconds > 120
  ) {
    return undefined;
  }
  const issuedAt = Math.floor(now / 1_000);
  const payload: CapabilityPayload = {
    v: CAPABILITY_VERSION,
    a: action,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    n: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
    c: await demoClientBinding(request),
  };
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await sign(encodedPayload);
  return signature
    ? {
        token: `${encodedPayload}.${signature}`,
        expiresInSeconds: ttlSeconds,
      }
    : undefined;
}

function isCapabilityPayload(
  value: unknown,
  action: DemoCapabilityAction,
  clientBinding: string,
  nowSeconds: number,
): value is CapabilityPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    Object.keys(payload).length === 6 &&
    payload.v === CAPABILITY_VERSION &&
    payload.a === action &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    payload.iat <= nowSeconds + 5 &&
    payload.exp > nowSeconds &&
    payload.exp - payload.iat <= 120 &&
    typeof payload.n === "string" &&
    /^[A-Za-z0-9_-]{20,32}$/u.test(payload.n) &&
    payload.c === clientBinding
  );
}

function pruneConsumedNonces(nowSeconds: number): void {
  const consumed = nonceStore().consumed;
  for (const [nonce, expiresAt] of consumed) {
    if (expiresAt <= nowSeconds) consumed.delete(nonce);
  }
}

export type CapabilityVerification =
  | { ok: true; clientBinding: string }
  | {
      ok: false;
      reason:
        | "not-configured"
        | "missing"
        | "invalid"
        | "expired-or-mismatched"
        | "replayed";
    };

export async function verifyAndConsumeDemoCapability(
  request: Request,
  action: DemoCapabilityAction,
  token: string | null = request.headers.get("x-carerelay-capability"),
  now = Date.now(),
): Promise<CapabilityVerification> {
  const key = await signingKey("verify");
  if (!key) return { ok: false, reason: "not-configured" };
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > MAX_CAPABILITY_TOKEN_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return { ok: false, reason: "invalid" };
  }
  const signature = base64UrlDecode(encodedSignature);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!signature || !payloadBytes) return { ok: false, reason: "invalid" };
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    copiedArrayBuffer(signature),
    new TextEncoder().encode(encodedPayload),
  );
  if (!validSignature) return { ok: false, reason: "invalid" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    ) as unknown;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const clientBinding = await demoClientBinding(request);
  const nowSeconds = Math.floor(now / 1_000);
  if (!isCapabilityPayload(parsed, action, clientBinding, nowSeconds)) {
    return { ok: false, reason: "expired-or-mismatched" };
  }

  pruneConsumedNonces(nowSeconds);
  const consumed = nonceStore().consumed;
  if (consumed.has(parsed.n)) {
    return { ok: false, reason: "replayed" };
  }
  consumed.set(parsed.n, parsed.exp);
  return { ok: true, clientBinding };
}

export function resetDemoCapabilityState(): void {
  const target = globalThis as typeof globalThis & {
    [SECRET_STORE_SYMBOL]?: Uint8Array;
    [NONCE_STORE_SYMBOL]?: NonceStore;
  };
  delete target[SECRET_STORE_SYMBOL];
  target[NONCE_STORE_SYMBOL] = { consumed: new Map() };
}
