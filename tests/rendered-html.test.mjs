import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the built Worker is explicitly marked as production", async () => {
  const config = JSON.parse(
    await readFile(
      new URL("../dist/server/wrangler.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(config.vars?.NODE_ENV, "production");
});

async function render(
  host = "localhost",
  forwardedHost,
) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        host,
        ...(forwardedHost
          ? { "x-forwarded-host": forwardedHost }
          : {}),
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("malformed forwarded hosts fall back without breaking the page", async () => {
  const response = await render("localhost", "localhost:abc");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(
    html,
    /<title>CareRelay · Synthetic referral clarity<\/title>/,
  );
});

test("server-renders the CareRelay synthetic and non-clinical boundary", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(self)",
  );
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin",
  );

  const html = await response.text();
  assert.match(html, /<html lang="en-GB">/);
  assert.match(
    html,
    /<title>CareRelay · Synthetic referral clarity<\/title>/,
  );
  assert.match(html, /href="#main-content">Skip to main content<\/a>/);
  assert.match(html, /<header class="app-header">/);
  assert.match(html, /<aside class="sidebar">/);
  assert.match(html, /<nav aria-label="Primary navigation">/);
  assert.match(html, /<main id="main-content">/);
  assert.match(
    html,
    /<h1 tabindex="-1">Know what your letter means — and what to do next\.<\/h1>/,
  );

  assert.match(html, /Synthetic demonstration/);
  assert.match(html, /Independent prototype · no NHS connection/);
  assert.match(html, /Administrative support/);
  assert.match(html, /Not medical advice or emergency care/);
  assert.match(html, /Independent · not medical advice/);
  assert.match(
    html,
    /Synthetic letter for product testing\. It is not connected to a real patient or NHS organisation\./,
  );
  assert.match(
    html,
    /Independent synthetic document · no real patient/,
  );
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|Codex/);
});

test("server-renders the bounded default workflow and accessible states", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /role="radiogroup" aria-label="Synthetic case"/);
  assert.match(html, /CR-RHE-4101/);
  assert.match(html, /Bundled example shown before verification/);
  assert.match(html, /CR-DIA-2207(?:<!-- -->)? · preview/);
  assert.match(html, /CR-CAR-3094(?:<!-- -->)? · preview/);
  assert.match(html, /Bundled preview only/);

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemax="6"/);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /Prototype interaction evidence · not a clinical outcome/);
  assert.match(html, /<button class="button button-light" disabled=""/);

  assert.match(html, /Verify the supplied synthetic PDF/);
  assert.match(html, /No file storage/);
  assert.match(html, /Synthetic fixture only/);
  assert.match(html, /PDF · 4 MB maximum · 6 pages maximum/);
  assert.match(html, /accept="\.pdf,application\/pdf"/);
  assert.match(html, /Use synthetic demo PDF/);
  assert.match(
    html,
    /href="\/demo\/rheumatology-referral-synthetic\.pdf"/,
  );
  assert.match(html, /Ready for a synthetic document/);
  assert.match(html, /aria-live="polite" role="status"/);

  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab" tabindex="0"/);
  assert.match(html, /role="tabpanel" tabindex="0"/);
  assert.match(html, /data-passage-id="rheumatology:p1:not-accepted"/);
  assert.match(html, /Bundled example explanation/);
  assert.match(html, /Checked against bundled example/);
  assert.match(
    html,
    /Do not travel to the clinic unless a booking is confirmed\./,
  );

  assert.match(html, /Ask about this letter/);
  assert.match(html, /Grounded questions and follow-ups/);
  assert.match(
    html,
    /Answers use only the two-page synthetic source\. If the document does not say, CareRelay tells you\./,
  );
  assert.match(html, /Ask a question about this letter…/);

  assert.match(html, /Rehearse the clinic call before it is real\./);
  assert.match(
    html,
    /I understand this uses synthetic data and will not place a real call\./,
  );
  assert.match(html, /Start controlled rehearsal/);
  assert.match(html, /does not dial, listen to or record a real call\./);
});

test("source retains responsive, keyboard and reduced-motion safeguards", async () => {
  const [app, css, layout, page] = await Promise.all([
    readFile(new URL("../app/CareRelayApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<CareRelayApp \/>/);
  assert.match(layout, /<html lang="en-GB">/);
  assert.match(layout, /\/og\.png/);
  assert.doesNotMatch(page + layout, /SkeletonPreview|codex-preview/);

  assert.match(app, /event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /event\.key === "Home"/);
  assert.match(app, /event\.key === "End"/);
  assert.match(app, /performance\.now\(\)/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);

  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-width:\s*610px/);
});
