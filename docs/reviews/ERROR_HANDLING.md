# Error Handling Review

Date: 25 July 2026

## Error Handling Summary

- Scope: JSON and multipart API routes, optional provider calls, coordinator boundaries, document parsing, browser upload/question/voice/call workflows and unexpected homepage metadata input.
- Main failure modes: invalid input, oversized or slow bodies, altered PDFs, parser deadlines, clinical or unsupported questions, provider timeout or malformed output, quota rejection, missing production co-ordination, stale browser responses and unexpected programming errors.
- Current gaps: there is no durable diagnostic or audit sink; safe diagnostics deliberately omit exception details; nonce replay protection is not distributed; manual assistive-technology and native file-picker checks remain outstanding.
- Fixes made: consistent `ok: false` API errors, correlated request IDs, safe unexpected-error diagnostics, linked provider deadlines and cancellation, stable coordinator timeout results, readiness coalescing, malformed-host fallback, guarded duplicate submissions and explicit browser loading/error/retry/success states.
- Verification: 100 unit tests, five built-Worker tests and eleven production-runtime browser tests pass, alongside type-checking, linting and a production build.
- Residual risks: production provider paths remain disabled until distributed co-ordination and secret bindings exist; platform observability retention and access policy are not configured.

## API Contract

Failures use a stable machine-readable shape:

```json
{
  "ok": false,
  "error": {
    "code": "stable_error_code",
    "message": "Safe user-facing explanation."
  },
  "requestId": "bounded-correlation-id"
}
```

The same request ID is returned in `X-Request-ID`. JSON and media responses use `Cache-Control: no-store`. Error details never contain uploaded text, questions, transcripts, telephone numbers, credentials, raw provider payloads or stack traces.

## Recovery Behaviour

- Invalid or altered documents are rejected before expensive parsing where possible and leave a retry action visible.
- Slow request bodies and PDF analysis have independent deadlines.
- Unsupported or clinical questions become a fixed source-boundary abstention.
- Anthropic failure leaves the deterministic abstention unchanged.
- ElevenLabs failure directs the client to device speech.
- Controlled-call failure releases its permit; an accepted call with uncertain cooldown state explicitly warns against retrying.
- Provider quota or co-ordination failure returns a stable status and `Retry-After` where relevant.
- Changing case, resetting or leaving a view invalidates or aborts stale browser work.

## Observability Boundary

Expected errors are returned without duplicate logging. An unexpected exception emits only:

- event name;
- request ID;
- HTTP method; and
- pathname.

The logger excludes headers, bodies, exception messages and stacks. Richer operational diagnosis requires a separately designed redacting observability service.
