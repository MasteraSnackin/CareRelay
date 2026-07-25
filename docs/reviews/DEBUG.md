# Debug Report

Date: 25 July 2026

## Root Cause

Five reproducible defects were found.

1. The built Worker had no `NODE_ENV` binding. `isProductionRuntime()` therefore treated the production build as local development, allowing an ephemeral capability secret and process-local quota path.
2. Provider timers signalled `fetch` but did not bound a non-compliant fetch implementation or a response body that stalled after headers. Parent request cancellation also did not reach Anthropic.
3. Distributed coordinator acquisition had no deadline, and coordinator exceptions escaped as generic internal failures.
4. The metadata base-URL helper accepted a safe character set but did not catch URL parsing failures. A forwarded host such as `localhost:abc` caused the homepage to return 500 after the request reached application code.
5. The app had no `next/image` use or `IMAGES` binding, but `/_vinext/image` remained reachable through the framework handler and could expose an unusable optimisation path.

Repeated provider-readiness clicks also created duplicate upstream checks for the same configuration generation.

## Fix

- Bind `NODE_ENV=production` in generated Worker builds and `development` in the live development configuration.
- Apply one linked provider deadline to request dispatch and streamed response reads for Anthropic, ElevenLabs and Twilio.
- Propagate incoming request cancellation, discard late responses and retain the no-retry policy.
- Bound distributed coordinator operations to two seconds and map exceptions or timeouts to stable fail-closed results.
- Coalesce provider-readiness checks and reuse a recent result for ten seconds.
- Catch malformed host/port parsing and fall back to the configured public origin.
- Remove the unused custom image optimiser and explicitly return a secured 404 for `/_vinext/image`.
- Add `ok: false` to API errors and emit a minimal unexpected-error diagnostic containing only event, request ID, method and pathname.

## Verification

- Command: focused backend Node tests.
- Result: 38/38 passed.
- Command: full TypeScript unit suite.
- Result: 100/100 passed.
- Command: fresh production build and built-Worker tests.
- Result: build passed; 5/5 Worker tests passed.
- Browser check: the Wrangler-hosted suite passed 11/11 tests, including production capability denial and the removed image route.
- Reproduction check: capability issuance changed from an unsafe 200 before the runtime-mode fix to normalised `503 capability_service_unavailable` after it.
- Host check: a malformed `X-Forwarded-Host` now renders the fallback page rather than producing a 500 response. A syntactically invalid HTTP `Host` may still be rejected by the local runtime before application code runs.

## Residual Risk

- Capability nonce consumption remains isolate-local.
- Production provider work has no distributed quota or call adapter and therefore remains intentionally unavailable.
- Safe unexpected-error diagnostics omit exception messages and stacks to avoid leaking submitted or provider data.
- Native file-picker behaviour remains partly dependent on the operating system.

## Follow-up

Implement a distributed coordinator with atomic nonce consumption and expiring leases, then run the same fail-closed acceptance tests against a deployed multi-isolate staging Worker.
