# Build Report

Date: 25 July 2026

## Implemented Behaviour

- The exact synthetic rheumatology PDF is verified through bounded upload, fingerprint, marker, text and citation-coordinate checks.
- Grounded questions are handled deterministically first; optional Claude output can select only one server-owned administrative intent.
- Provider speech and controlled calls require short-lived action-specific capabilities, fixed server-owned content and quota permits.
- Production builds now identify themselves explicitly and fail closed when production secrets or distributed coordinators are absent.
- Provider dispatch, streamed bodies and coordinator calls have explicit deadlines and cancellation.
- The primary PDF action is visible immediately on desktop and mobile, and the native file picker is triggered by a real keyboard-focusable button.
- Loading, rejection, retry, verified, abstained and completed-rehearsal states are distinct.
- Workers Assets serve generated chunks and public fixture files with exact media types and defensive headers.

## Files Changed

The implementation affects:

- interface components and styles under `app/`;
- API route handlers under `app/api/`;
- grounding, fixture, provider, runtime and error boundaries under `lib/`;
- the Cloudflare Worker entry and Vite configuration;
- deterministic public fixture artefacts;
- unit, built-Worker and browser tests;
- CI configuration and environment template; and
- project and quality documentation.

The detailed file-level changes are available in the repository diff. No provider credential or real patient data was added.

## Verification Commands and Results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run check:fixture` — passed.
- `npm run test:unit` — 100/100 passed.
- `npm run build` — passed.
- `npm run test:worker:built` — 5/5 passed.
- `npm run test:browser:built` — 11/11 passed against Wrangler.
- `npm audit --omit=dev` — zero production vulnerabilities.

## Known Limitations

- Only one exact PDF can enter the verified-upload path.
- Diabetes and cardiology remain preview-only cases.
- The project has no authentication, persistent data, distributed provider coordinator or durable audit store.
- Paid provider and controlled-call paths intentionally remain unavailable in production until those controls are implemented.
- Browser tests do not replace manual screen-reader, high-contrast, real zoom or native file-picker testing.

## Recommended Next Step

Deploy the provider-disabled synthetic workflow to a staging Worker, run the complete acceptance suite there, then prototype the distributed coordinator separately before considering any paid provider.
