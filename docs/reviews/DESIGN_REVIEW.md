# Design Review

Date: 25 July 2026

## Design Diagnosis

The interface has a clear evidence-first visual system, strong synthetic-data boundaries and consistent source, explanation and action cards. Its main weakness was task visibility: on a mobile viewport, a user could understand the proposition without seeing how to begin. The file-picker presentation also created a mismatch between the visible control and the element that received focus.

The target user is a person trying to understand a difficult administrative referral letter without mistaking the product for clinical advice. Their primary task is to verify the supplied synthetic PDF, inspect evidence and identify a safe administrative next step.

## Proposed Changes

- Put the primary bundled-PDF verification action in the page introduction so the task is visible immediately.
- Keep the detailed upload card as the evidence and status surface rather than duplicating its full content above the fold.
- Use a real button for the native file picker so keyboard focus remains visible.
- Mark the upload region busy during verification and strengthen success and rejection status differentiation.
- Describe closing the guided panel as “Pause”, because confirmed session evidence is retained.
- Mark the active guided step semantically with `aria-current="step"`.

## Files and Components Affected

- `app/CareRelayApp.tsx`
- `app/GuidedDemoBar.tsx`
- `app/globals.css`
- `tests/guided-demo-bar.test.tsx`
- `tests/browser/care-relay.spec.ts`

## Before and After Verification

Before the change, the first actionable upload control was below the first 390-pixel-wide viewport and the visible picker label could leave focus on a clipped input.

After the change:

- the bundled-PDF action is visible in the first desktop and mobile viewport;
- the file-picker trigger is a visible, focusable button;
- loading, rejection, retry and verified states remain distinct;
- all four main hydrated views pass the automated axe A/AA ruleset;
- navigation and page content reflow without horizontal overflow at mobile, 200% and 400% equivalent widths; and
- the full production-runtime browser suite passes.

## Remaining Design Risks

- The long evidence page needs manual testing with screen readers and real zoom controls.
- Native file-picker appearance and behaviour vary by operating system.
- The pre-authored translated copy is explicitly unreviewed.
- The interface is intentionally optimised for one synthetic fixture, not arbitrary document upload.
