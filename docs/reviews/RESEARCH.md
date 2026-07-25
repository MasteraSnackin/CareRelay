# Platform Research: Vinext, Vite and Cloudflare Workers

Research status: 25 July 2026.

## Research Question

Does CareRelay’s current Vinext, Vite and Cloudflare Workers architecture match the behaviour documented by its platform providers, and what are the smallest remaining experiments needed before describing the bounded synthetic workflow as production-ready?

Evidence that would change the decision includes:

- a real Worker failure in server rendering, hydration, route handling, asset delivery or PDF parsing;
- a Vinext compatibility gap in an API CareRelay actually uses;
- Worker CPU, memory, startup or bundle limits being exceeded by the current build;
- a need to enable paid providers without a demonstrably atomic cross-isolate co-ordinator; or
- product scope expanding to Next.js features outside CareRelay’s present one-page App Router and eight-route-handler subset.

## Sources Checked

All web sources are official platform documentation or the platform owner’s primary repository. They were accessed on 25 July 2026.

| Source | Date shown by source | Relevance |
| --- | --- | --- |
| [CareRelay package and lockfile](../../package.json) | Repository state inspected 25 July 2026 | Exact installed stack, scripts and Node requirement. |
| [CareRelay Vite configuration](../../vite.config.ts) | Repository state inspected 25 July 2026 | Worker entry, `nodejs_compat`, asset routing, `NODE_ENV` and inactive storage scaffolding. |
| [CareRelay Worker entry](../../worker/index.ts) | Repository state inspected 25 July 2026 | App Router delegation, public-asset handling, media types and response headers. |
| [Vinext primary repository](https://github.com/cloudflare/vinext) | Current repository read 25 July 2026 | Project status, supported surface, `vinext check`, Cloudflare deployment and comparison with OpenNext. |
| [Cloudflare Vite plugin: static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/) | Last updated 23 April 2026 | Generated client asset directory and `ASSETS` binding behaviour. |
| [Workers Assets configuration and bindings](https://developers.cloudflare.com/workers/static-assets/binding/) | Accessed 25 July 2026 | `run_worker_first` semantics and latency trade-off. |
| [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/) | Accessed 25 July 2026 | Isolate eviction, concurrent requests and the lack of shared global state. |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Last updated 5 July 2026 | Bundle, memory, CPU, connection and request limits. |
| [Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) | Last updated 23 April 2026 | `nodejs_compat` and compatibility-date behaviour. |
| [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) | Last updated 15 July 2026 | Strongly consistent stateful co-ordination and sharding guidance. |
| [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) | Last updated 23 April 2026 | Location-local, permissive and eventually consistent counter semantics. |
| [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) | Last updated 3 July 2026 | Secret bindings and required-secret declaration. |
| [Workers testing](https://developers.cloudflare.com/workers/testing/) | Last updated 3 July 2026 | Recommended Workers Vitest integration and Durable Object test support. |
| [Cloudflare’s Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) | Last updated 5 June 2026 | Cloudflare’s documented OpenNext deployment path and `workerd` preview guidance. |
| [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Last updated 9 June 2026 | Platform invocation logs and required observability configuration. |

Commands used for repository evidence:

```bash
npx --no-install vinext check
npx --no-install wrangler deploy --cwd dist/server -c wrangler.json --dry-run --outdir <TEMP_DIR>
```

Both commands are read-only with respect to deployed Cloudflare state. The Wrangler command writes only to the supplied temporary output directory.

## Findings

### Facts from the repository

1. CareRelay currently locks Vinext 0.0.50, Vite 8.1.5, Cloudflare Vite plugin 1.47.0 and Wrangler 4.114.0. It targets Node.js 22.13.0 or later for local tooling.
2. `vinext check` reported 100% compatibility for the six items it detected: one `next/headers` import, one supported `headers` configuration option, App Router, one page, one layout and eight route handlers. This is the scanner’s result, not a complete runtime proof.
3. `vite.config.ts` configures `worker/index.ts`, `nodejs_compat`, `ASSETS` with `run_worker_first: true`, and an explicit `NODE_ENV` value of `production` for builds and `development` otherwise.
4. `.openai/hosting.json` currently sets D1 and R2 to `null`. The generated Worker configuration has no D1, R2, KV, Durable Object, service, Queue or rate-limiting binding.
5. The Worker serves known PDF, PNG, SVG, JSON and bundled client assets through `env.ASSETS`, applies exact media types and wraps them with the same defensive headers as dynamic responses.
6. CareRelay does not use `next/image`. The reserved `/_vinext/image` path returns an explicit `404`; there is no `IMAGES` binding or image transformation dependency.
7. The current built configuration uses compatibility date `2026-07-23`, but source configuration does not pin that date. It is supplied by the currently locked Cloudflare Vite plugin default.
8. A fresh built-output Wrangler dry run on 25 July 2026 succeeded. It found 33 static files, 3,200.56 KiB of Worker modules and a total upload of 3,916.85 KiB compressed to 946.21 KiB. The only runtime bindings reported were `ASSETS` and `NODE_ENV="production"`.
9. The compressed Worker is below Cloudflare’s documented 3 MB Free-plan and 10 MB Paid-plan compressed bundle limits. A dry run does not report or prove production startup time.
10. Unit tests execute domain and route logic, built-Worker tests import fresh output, and Playwright starts that output in Wrangler’s local `workerd` runtime. No real Cloudflare staging deployment is recorded.
11. Provider quota and controlled-call interfaces exist, but no production adapter calls `configureProviderAbuseCoordinator` or `configureTwilioCallCoordinator`. Production paid-provider capability issuance therefore fails closed.
12. Capability nonce consumption, parser admission, temporary credentials and development counters use isolate- or process-local memory.
13. Unexpected API exceptions produce one structured event containing only event name, request identifier, method and pathname. Expected API errors are normalised but not application-logged. There is no durable audit sink, alert definition or repository-owned retention policy.
14. Exact same-origin enforcement covers provider and temporary-secret routes. `/api/documents` and the deterministic part of `/api/analyse` do not require an `Origin` header.
15. Provider request and response-body work shares an abortable deadline and inherits client cancellation. Co-ordinator operations fail closed after two seconds, while provider-readiness checks share one in-flight operation and cache results for ten seconds within the active process or isolate.

### Facts from official platform sources

1. Vinext describes itself as under active development, not a drop-in replacement for every production workload, and advises evaluating the exact application surface before adoption.
2. Vinext reimplements the Next.js API surface on Vite. Its own documentation calls OpenNext the more mature and safer option when broad Next.js compatibility is required.
3. Cloudflare’s current official Next.js framework guide uses the OpenNext adapter. This does not make Vinext unsupported, but it means CareRelay’s adapter choice needs application-specific evidence.
4. The Cloudflare Vite plugin generates the final client asset directory. `run_worker_first: true` does invoke Worker code before matching static assets, which agrees with CareRelay’s header-wrapping design. Cloudflare notes that Worker-first routing can add asset latency.
5. Cloudflare states that Worker global memory is neither durable nor shared: requests may reach different isolates, isolates may be evicted, and one isolate may interleave requests while awaiting I/O.
6. Cloudflare describes Durable Objects as the primitive for stateful co-ordination and strong consistency. This matches CareRelay’s stated need for atomic provider quota, nonce and controlled-call lease state.
7. The Workers Rate Limiting binding is location-local, permissive and eventually consistent. Cloudflare explicitly says it is not an accurate accounting system. It is unsuitable as the sole spend or exactly-once control required by CareRelay.
8. A Worker isolate has 128 MB of memory and can handle concurrent requests. CareRelay’s 4 MiB upload cap is below that limit, but the complete PDF parser working set and overlapping requests still need measurement.
9. Cloudflare recommends Worker secret bindings for API keys and supports required-secret declarations that fail deployment when values are absent. CareRelay does not yet declare required production secrets.
10. Cloudflare recommends its Workers Vitest integration for runtime tests; it supports direct Durable Object access and eviction testing. CareRelay currently uses the Node test runner plus local Wrangler and Playwright instead.

### Inferences

1. The current Vinext architecture is reasonable for CareRelay’s narrow, tested feature set, but “local tests pass” is weaker evidence than a provider-disabled real-Worker canary. Vinext’s maturity makes that canary a release gate, not an optional confidence exercise.
2. The Worker-first asset description is accurate. Its latency cost is likely small for this demonstration but has not been measured from geographically separated clients.
3. Production fail-closed behaviour is the correct current choice. Substituting the Workers Rate Limiting binding alone would weaken the stated accounting guarantee.
4. The most natural first distributed-coordination experiment is a Durable Object, but the final object key and sharding model require a decision. A single global object would create a bottleneck; client, action or deployment-level atoms have different consistency and quota semantics.
5. The current upload limits are plausibly within Worker memory, but this cannot be asserted as production-safe from byte limits alone because `unpdf` and PDF.js create additional in-memory structures.
6. Lack of same-origin or edge admission controls on document parsing is not a data-disclosure issue by itself, but it permits third-party sites or automated clients to consume bounded parser work. It should be measured and mitigated before a public launch.
7. Replacing Vinext immediately would create a larger safety regression surface than running the small staging experiment. OpenNext becomes the preferred comparison if CareRelay expands to unsupported APIs or the canary exposes runtime differences.

## Options

| Option | Benefits | Costs and risks | Evidence needed |
| --- | --- | --- | --- |
| Keep Vinext for the bounded demonstration | Smallest change; current scanner, build, Worker and browser suites pass; direct Vite and Workers integration. | Active-development adapter, custom Worker entry seam and no real deployment evidence. | Provider-disabled staging canary, resource measurements and an upgrade acceptance gate. |
| Migrate to OpenNext now | Cloudflare’s documented Next.js path; Vinext itself describes OpenNext as more mature. | Build and runtime migration could invalidate header, asset, PDF, route and safety assumptions; no demonstrated CareRelay defect currently justifies it. | Time-boxed branch running the identical unit, Worker and browser acceptance suite. |
| Self-host standard Next.js on Node | Uses standard `next build` output and avoids Worker runtime constraints. | Adds server, patching, scaling, network and secret-management operations; loses the current `workerd` evidence and requires a new deployment threat model. | Operational owner, hosting design and the same end-to-end safety suite. |

## Recommendation

Retain Vinext only for the present synthetic demonstration and label it production-shaped, not production-ready, until the real-Worker canary passes. Keep all paid providers closed in production.

Do not migrate frameworks solely because OpenNext is more mature. First test the exact CareRelay surface. If server rendering, route handling, asset behaviour, startup or PDF parsing fails on Workers, or if the product needs Vinext-incomplete APIs, run an OpenNext control branch and compare both builds with the same acceptance criteria.

For distributed provider safeguards, use a Durable Object spike rather than the Workers Rate Limiting binding as the authoritative control. The latter may still be useful as an additional coarse abuse signal, but not as accounting or exactly-once state.

## Unknowns

- No Cloudflare account, plan, staging hostname, deployment owner or rollback process is identified in the repository.
- Real-Worker startup time, PDF parsing CPU, peak isolate memory and concurrent-upload behaviour are unmeasured.
- Asset and API latency with Worker-first routing is unmeasured across locations.
- The project has not explicitly pinned or reviewed a Worker compatibility date.
- The correct Durable Object keying and sharding model for global, per-client and per-action quotas is undecided.
- Capability nonce consumption remains cross-isolate unsafe until moved into shared atomic state.
- Required-secret declarations, rotation ownership and preview-versus-production separation are absent.
- Worker log sampling, retention, access, export and alert policy are unspecified.
- Provider data residency, retention, subprocessor and account-control terms were outside this narrow platform review.
- Manual assistive-technology, privacy, clinical safety and security assurance remain outside automated test evidence.

## Next Experiment

### Experiment 1: provider-disabled real-Worker canary

This is the smallest immediate production-readiness experiment.

Preconditions:

- pin a reviewed Worker compatibility date in source;
- use a dedicated staging Worker and synthetic fixture only;
- configure no Anthropic, ElevenLabs or Twilio credentials;
- keep temporary credential entry and live calls disabled; and
- record the Workers plan and test location.

Build and local gates:

```bash
npm ci
npx --no-install vinext check
npm run typecheck
npm run lint
npm run check:fixture
npm run test:all
npm run build
npx --no-install wrangler deploy --cwd dist/server -c wrangler.json --dry-run --outdir <TEMP_DIR>
```

After Cloudflare authentication and explicit staging approval, deploy the already verified output:

```bash
npx --no-install wrangler deploy --cwd dist/server -c wrangler.json --name <STAGING_WORKER_NAME>
```

Acceptance criteria:

- `/` server-renders, hydrates and completes the existing browser workflow;
- all committed PDF, PNG, SVG and JSON assets have exact media types and defensive headers;
- `/_vinext/image` returns `404`;
- the exact PDF verifies and a one-byte alteration fails;
- API JSON remains `no-store` and correlates errors with `X-Request-ID`;
- provider capability issuance returns the documented production `503` and no provider is contacted;
- bounded concurrent valid and invalid uploads produce no Worker CPU, memory or startup-limit errors;
- observed logs contain no document text, questions, headers, credentials, payloads, exception messages or stacks; and
- rollback to the previous Worker version is rehearsed.

Record request count, p50 and p95 latency, CPU time, peak memory evidence available from the platform, status distribution and invocation outcomes. A successful local Wrangler run is not a substitute for these measurements.

### Experiment 2: distributed co-ordinator spike

Run only after the provider-disabled canary.

Implement a no-provider Durable Object test adapter for quota, nonce and call-lease state. Use the Workers Vitest integration to prove:

- atomic per-client and global limits under parallel requests;
- bounded action-specific concurrency;
- exactly one successful nonce consumption;
- safe permit release and expiring leases after simulated failure;
- cooldown persistence across Durable Object eviction; and
- explicit fail-closed behaviour on overload or co-ordinator errors.

Do not add provider credentials to this experiment. Only after those properties pass locally should a separate staging test assess cross-location routing and operational telemetry.
