# Technical Review

Date: 25 July 2026

## Technical Risks Found

### P1 — Production runtime identity

The built Worker previously omitted its environment identity and could choose local-only capability controls. This was reproducible and is fixed by an explicit production binding plus an end-to-end regression.

### P2 — Distributed authority is incomplete

Provider quota and controlled-call coordinator interfaces exist, but no production adapter is wired. Capability nonce consumption is isolate-local. The system correctly fails closed, but it must not claim cross-isolate one-use semantics.

### P2 — Main client component size

`CareRelayApp.tsx` remains a large orchestration component even after document upload, voice, credentials, rehearsal and session logic were extracted. Further splitting could improve maintainability, but a broad refactor was not justified during this safety pass.

### P2 — Development-tool dependency advisories

The production dependency audit is clean. The complete npm audit still reports nine high-severity development-only advisories in the ESLint `minimatch`/`brace-expansion` chain. npm proposes major or otherwise unsuitable lint-stack changes, so no forced upgrade was applied.

### P3 — Framework compatibility

The project uses Vinext as a compatibility layer over Next.js App Router conventions. Its behaviour must be rechecked on upgrades, especially Worker environment propagation, asset routing and unsupported framework features.

### P3 — Social preview weight

The 1200 × 630 `og.png` is visually correct but approximately 858 KiB. It is not part of the interactive application bundle, but a future lossless or visually reviewed optimisation could reduce unfurl transfer size.

## Priority Ranking

1. Preserve the production-mode and fail-closed regressions in CI.
2. Implement atomic distributed nonce, quota and call leasing before enabling providers.
3. Exercise the provider-disabled path on a real staging Worker.
4. Address development-tool advisories when compatible upstream releases are available.
5. Split additional client orchestration only when a concrete change requires it.
6. Optimise the social card only with visual comparison and unchanged metadata dimensions.

## Changes Made

- Bound production and development runtime modes explicitly.
- Added shared provider deadlines, parent cancellation and late-response disposal.
- Bounded coordinator calls and normalised their failures.
- Coalesced readiness checks.
- Added safe unexpected-error diagnostics.
- Fixed malformed metadata-host handling.
- Removed the unused image-optimisation dependency path and secured its route as 404.
- Aligned and committed the environment-variable template.
- Added UI focus, responsive primary-action and state-semantic improvements.
- Expanded unit, Worker and browser regressions around the corrected boundaries.

## Verification Evidence

- TypeScript and ESLint pass without suppressing the new code.
- All 100 unit tests pass.
- All five freshly built Worker tests pass.
- All eleven Wrangler-hosted browser tests pass, including axe checks, mobile and high-zoom-equivalent reflow.
- The deterministic fixture, both page renders, social card and manifest pass their hash and dimension checks.
- The production dependency audit reports zero vulnerabilities.

## Residual Risk

- No result here constitutes a penetration test, clinical safety case, accessibility certification or production healthcare assurance.
- Local loopback timing is not a production performance benchmark.
- Observability, secrets, deployment access controls and distributed co-ordination need a real staging design.
- The translated demonstration copy remains unreviewed.
