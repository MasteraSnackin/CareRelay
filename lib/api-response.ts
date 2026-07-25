export const JSON_CONTENT_TYPE = "application/json";
export const DEFAULT_BODY_READ_TIMEOUT_MS = 10_000;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,63})$/;

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly headers?: HeadersInit;

  constructor(code: string, message: string, status = 400, headers?: HeadersInit) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

export class BodyLimitError extends ApiError {
  constructor(maxBytes: number) {
    super(
      "request_body_too_large",
      `The request body exceeds the ${maxBytes}-byte limit.`,
      413,
    );
    this.name = "BodyLimitError";
  }
}

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function requestIdFor(request: Request): string {
  const candidate = request.headers.get("x-request-id");
  return isValidRequestId(candidate) ? candidate : crypto.randomUUID();
}

function responseHeaders(
  requestId: string,
  initial?: HeadersInit,
  contentType = `${JSON_CONTENT_TYPE}; charset=utf-8`,
): Headers {
  const headers = new Headers(initial);
  headers.set("X-Request-ID", requestId);
  headers.set("Cache-Control", "no-store");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  return headers;
}

export function jsonResponse(
  requestId: string,
  data: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: responseHeaders(requestId, init.headers),
  });
}

export function errorResponse(requestId: string, error: unknown): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          "internal_error",
          "The request could not be completed.",
          500,
        );
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: apiError.code,
      message: apiError.message,
    },
    requestId,
  };

  return jsonResponse(requestId, body, {
    status: apiError.status,
    headers: apiError.headers,
  });
}

export function mediaResponse(
  requestId: string,
  body: BodyInit,
  contentType: string,
  init: ResponseInit = {},
): Response {
  return new Response(body, {
    ...init,
    headers: responseHeaders(requestId, init.headers, contentType),
  });
}

function declaredContentLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new ApiError(
      "invalid_content_length",
      "The Content-Length header is invalid.",
      400,
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new ApiError(
      "invalid_content_length",
      "The Content-Length header is invalid.",
      400,
    );
  }
  return length;
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
  {
    timeoutMs = DEFAULT_BODY_READ_TIMEOUT_MS,
    signal = request.signal,
  }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const declared = declaredContentLength(request);
  if (declared !== undefined && declared > maxBytes) {
    throw new BodyLimitError(maxBytes);
  }

  if (!request.body) {
    return new Uint8Array();
  }
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 60_000
  ) {
    throw new ApiError(
      "invalid_body_timeout",
      "The request-body timeout is invalid.",
      500,
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const rejectInterrupted = () => {
      reject(
        new ApiError(
          "request_body_timeout",
          "The request body was not received within the permitted time.",
          408,
        ),
      );
    };
    timeoutHandle = setTimeout(rejectInterrupted, timeoutMs);
    abortHandler = rejectInterrupted;
    if (signal.aborted) {
      rejectInterrupted();
    } else {
      signal.addEventListener("abort", rejectInterrupted, { once: true });
    }
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        interrupted,
      ]);
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new BodyLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "request_body_timeout") {
      await reader
        .cancel("request body read interrupted")
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function isJsonMediaType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return (
    typeof contentType === "string" &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE
  );
}

export async function readJsonWithLimit<T>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  if (!isJsonMediaType(request)) {
    throw new ApiError(
      "unsupported_media_type",
      "Content-Type must be application/json.",
      415,
    );
  }

  const bytes = await readBodyWithLimit(request, maxBytes);
  if (bytes.byteLength === 0) {
    throw new ApiError("invalid_json", "A JSON request body is required.", 400);
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new ApiError("invalid_json", "The request body is not valid JSON.", 400);
  }
}

export function assertPlainObject(
  value: unknown,
  code = "invalid_request",
  message = "The request body must be a JSON object.",
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ApiError(code, message, 400);
  }
}

export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new ApiError(
      "unexpected_field",
      "The request contains an unsupported field.",
      400,
    );
  }
}

export function requireSameOrigin(request: Request): URL {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new ApiError("cross_origin_request", "The request origin is not allowed.", 403);
  }

  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const hasAmbiguousForwarding =
    forwardedHost?.includes(",") || forwardedProto?.includes(",");

  if (
    hasAmbiguousForwarding ||
    (host !== null && host !== requestUrl.host) ||
    (forwardedHost !== null && forwardedHost !== requestUrl.host) ||
    (forwardedProto !== null && `${forwardedProto}:` !== requestUrl.protocol)
  ) {
    throw new ApiError(
      "conflicting_host_headers",
      "The request host headers are inconsistent.",
      403,
    );
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    throw new ApiError(
      "missing_origin",
      "An exact same-origin request is required.",
      403,
    );
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new ApiError("cross_origin_request", "The request origin is not allowed.", 403);
  }

  if (
    origin.origin !== requestUrl.origin ||
    originHeader !== origin.origin
  ) {
    throw new ApiError("cross_origin_request", "The request origin is not allowed.", 403);
  }
  return requestUrl;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalised = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalised === "localhost" ||
    normalised === "127.0.0.1" ||
    normalised === "::1"
  );
}

export async function handleApiRoute(
  request: Request,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdFor(request);
  try {
    return await handler(requestId);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      // Never log request bodies, headers, exception messages or stacks here:
      // provider credentials and submitted document text can pass through
      // these routes. The request ID correlates this safe diagnostic with the
      // normalised client response.
      console.error("CareRelay API request failed", {
        event: "api.unexpected_error",
        requestId,
        method: request.method,
        pathname: new URL(request.url).pathname,
      });
    }
    return errorResponse(requestId, error);
  }
}
