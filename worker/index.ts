/** Cloudflare Worker entry point for CareRelay. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const STATIC_MEDIA_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const PUBLIC_STATIC_ASSETS = new Set([
  "/care-relay-social-card.png",
  "/demo/rheumatology-fixture-manifest.json",
  "/demo/rheumatology-page-1.png",
  "/demo/rheumatology-page-2.png",
  "/demo/rheumatology-referral-synthetic.pdf",
  "/favicon.svg",
  "/og.png",
]);

function staticMediaType(pathname: string): string | undefined {
  const lowerPath = pathname.toLowerCase();
  for (const [extension, mediaType] of STATIC_MEDIA_TYPES) {
    if (lowerPath.endsWith(extension)) return mediaType;
  }
  return undefined;
}

function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  const mediaType = response.ok ? staticMediaType(pathname) : undefined;
  if (mediaType) headers.set("Content-Type", mediaType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self)",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (
      PUBLIC_STATIC_ASSETS.has(url.pathname) ||
      url.pathname.startsWith("/assets/")
    ) {
      return withSecurityHeaders(
        await env.ASSETS.fetch(request),
        url.pathname,
      );
    }

    if (url.pathname === "/_vinext/image") {
      return withSecurityHeaders(
        new Response("Not found", { status: 404 }),
        url.pathname,
      );
    }

    return withSecurityHeaders(
      await handler.fetch(request, env, ctx),
      url.pathname,
    );
  },
};

export default worker;
