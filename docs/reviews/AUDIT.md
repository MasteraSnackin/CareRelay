# Audit Report

Date: 25 July 2026

Scope: the primary synthetic rheumatology journey, including document verification, source citations, grounded questions, call rehearsal, provider-locked states, desktop and mobile layouts, keyboard operation and production-runtime asset behaviour.

## Summary

- Visual Score: 9/10
- Functional Score: 9/10
- Trust Score: 9/10
- Accessibility Score: 9/10
- Demo Readiness Score: 9/10

## What Works

- The synthetic-only and non-clinical boundary is visible throughout the primary journey.
- The first document-verification action is available in the first desktop and mobile viewport.
- The exact bundled PDF can move through loading and verified states, while altered or rejected input leaves a clear retry path.
- Supported answers remain attached to exact source passages; unsupported or clinical questions abstain.
- Case controls, source-page tabs, the file-picker trigger and the guided journey have complete keyboard semantics and visible focus.
- The four-step rehearsal records an outcome only after ordered completion and states that no external call was placed.
- The layout reflows without horizontal page overflow at mobile width and at widths equivalent to 200% and 400% browser zoom.
- The hydrated application has no automated axe WCAG A or AA violations in its four main views.
- Production-runtime tests confirm fail-closed provider capability issuance, exact public-asset media types and defensive headers.

## Critical Issues

No P0 or P1 issue remains in the bounded synthetic demonstration workflow.

The audit resolved two P1 usability defects:

- The actionable PDF control was below the first mobile viewport. A primary “Verify supplied PDF” action now appears beside the page introduction and loads the bundled fixture.
- The visible file-picker label transferred focus to a clipped input. It is now a real, visible button that retains keyboard focus while opening the native picker.

## Secondary Issues

- [P3] The evidence-rich page remains intentionally long. Impact: users must scroll after the primary action. Mitigation: the first action is now above the fold and headings preserve scanability.
- [P3] Native operating-system file-picker chrome is outside browser automation. Impact: the final platform-specific picker interaction still needs manual checking.
- [P3] Welsh and Polish demonstration copy has not received professional or clinical review. Impact: it cannot support a claim of translation equivalence. The interface labels this boundary.

## Missing States

- Loading: covered for document verification, grounded questions, readiness checks and controlled requests.
- Empty: the initial document, question and rehearsal states state what is available and what must happen next.
- Error: rejected uploads, unavailable providers, timeouts and locked live-call paths give a safe message and recovery action.
- Success: verified documents, citations, grounded answers and completed rehearsal outcomes have distinct confirmations.

## Recommended Fix Order

1. Complete manual testing with a screen reader, real browser zoom, high-contrast mode and native file pickers.
2. Professionally review translated demonstration copy before describing it as equivalent to the English source.
3. Implement production secrets and distributed co-ordination before enabling any paid provider or controlled call.

## Final Verdict

Ready with caveats for a synthetic local demonstration. It is not ready for real health information, clinical use or production paid-provider traffic.
