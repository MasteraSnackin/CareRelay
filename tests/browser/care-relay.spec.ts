import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type FixtureManifest = {
  files: {
    pdf: { bytes: number; sha256: string };
    pageOnePng: { bytes: number; sha256: string };
    pageTwoPng: { bytes: number; sha256: string };
    socialCardPng: { bytes: number; sha256: string };
  };
  passages: Array<{
    id: string;
    page: number;
    text: string;
    rectangles: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }>;
};

const verifiedStages = [
  { id: "upload", label: "Upload validated", verified: true },
  { id: "parse", label: "PDF parsed", verified: true },
  { id: "extract", label: "Text extracted", verified: true },
  {
    id: "synthetic-boundary",
    label: "Synthetic boundary verified",
    verified: true,
  },
  { id: "fixture", label: "Known fixture matched", verified: true },
  { id: "citations", label: "Citations mapped", verified: true },
];

async function openHydratedApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Know what your letter means — and what to do next.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use synthetic demo PDF" }),
  ).toBeEnabled();
}

async function fixtureResponse(): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../../public/demo/rheumatology-fixture-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as FixtureManifest;

  return {
    fixtureId: "rheumatology",
    pageCount: 2,
    pages: [1, 2].map((page) => ({
      page,
      text: manifest.passages
        .filter((passage) => passage.page === page)
        .map((passage) => passage.text)
        .join("\n"),
    })),
    verifiedStages,
    verification: {
      pdfSignature: true,
      fingerprint: true,
      syntheticMarkers: true,
      fixtureEvidence: true,
      citationCoordinates: true,
    },
    privacy: {
      storage: "none",
      retention: "request-only",
      uploadedBytesDiscarded: true,
    },
    citations: manifest.passages.map((passage) => ({
      passageId: passage.id,
      page: passage.page,
      rects: passage.rectangles,
    })),
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function settleHydratedUpdates(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test("reset cancels an in-flight upload and rejects its late result", async ({
  page,
}) => {
  const gate = deferred();
  const routeSettled = deferred();
  const response = await fixtureResponse();

  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    try {
      await gate.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: response }),
      });
    } catch {
      // A correctly cancelled browser request may close before fulfilment.
    } finally {
      routeSettled.resolve();
    }
  });

  try {
    await openHydratedApp(page);
    const uploadRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/documents",
    );
    await page.getByRole("button", { name: "Use synthetic demo PDF" }).click();
    await uploadRequest;
    await expect(
      page.getByText("Analysis in progress", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Reset demonstration" }).click();
    await expect(
      page.getByText("Ready for a synthetic document", { exact: true }).first(),
    ).toBeVisible();

    gate.resolve();
    await routeSettled.promise;
    await settleHydratedUpdates(page);
    await expect(
      page.getByText("Analysis verified", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Use synthetic demo PDF" }),
    ).toBeEnabled();
  } finally {
    gate.resolve();
  }
});

test("an upload rejection is clear and leaves a retry action available", async ({
  page,
}) => {
  await page.route("**/api/documents", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Use only the exact supplied synthetic PDF.",
        },
      }),
    });
  });

  await openHydratedApp(page);
  await page
    .getByRole("button", { name: "Verify supplied PDF", exact: true })
    .click();

  const uploadRegion = page.getByRole("region", {
    name: "Verify the supplied synthetic PDF",
  });
  await expect(
    uploadRegion.getByText("Document not accepted", { exact: true }),
  ).toBeVisible();
  await expect(
    uploadRegion.locator(".upload-state small"),
  ).toHaveText(
    "Document not accepted. Use only the exact supplied synthetic PDF.",
  );
  await expect(
    page.getByRole("button", {
      name: "Verify supplied PDF",
      exact: true,
    }),
  ).toBeEnabled();
});

test("case switching aborts a question and ignores its late answer", async ({
  page,
}) => {
  const gate = deferred();
  const routeSettled = deferred();
  const lateAnswer = "LATE_RHEUMATOLOGY_ANSWER_MUST_NOT_RENDER";

  await page.route("**/api/analyse", async (route) => {
    try {
      await gate.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            answer: lateAnswer,
            abstained: false,
            mode: "deterministic",
            claims: [
              {
                text: lateAnswer,
                citationIds: ["rheumatology:p1:received"],
              },
            ],
            citations: [
              {
                id: "rheumatology:p1:received",
                passageId: "rheumatology:p1:received",
                page: 1,
                quote:
                  "We confirm that your referral was received on 16 June 2026.",
              },
            ],
          },
        }),
      });
    } catch {
      // A correctly aborted request may disappear before fulfilment.
    } finally {
      routeSettled.resolve();
    }
  });

  try {
    await openHydratedApp(page);
    await page
      .getByRole("textbox", { name: "Ask a question about this letter" })
      .fill("What should I do next?");
    const analyseRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/analyse",
    );
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await analyseRequest;
    await expect(page.getByRole("button", { name: "Checking" })).toBeDisabled();

    const diabetes = page.getByRole("radio", { name: /Diabetes clinic/ });
    await diabetes.click();
    await expect(diabetes).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "Your diabetes clinic appointment is booked",
      }),
    ).toBeVisible();

    gate.resolve();
    await routeSettled.promise;
    await settleHydratedUpdates(page);
    await expect(page.getByText(lateAnswer)).toHaveCount(0);
    await expect(
      page.getByText(
        /Your appointment is on Wednesday 5 August 2026 at 10:20/,
      ).first(),
    ).toBeVisible();
  } finally {
    gate.resolve();
  }
});

test("a verified explanation citation opens its exact source page", async ({
  page,
}) => {
  await openHydratedApp(page);
  await page.getByRole("button", { name: "Use synthetic demo PDF" }).click();
  await expect(page.getByText("Analysis verified", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const citations = page.getByLabel("Explanation citations");
  await citations.getByRole("button", { name: /Page 2/ }).first().click();

  await expect(page.getByRole("tab", { name: "Page 2" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("img", {
      name: "Rendered synthetic rheumatology PDF, page 2",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Highlighted source on page 2.", { exact: true }),
  ).toBeVisible();
});

test("the controlled rehearsal records an outcome only after four steps", async ({
  page,
}) => {
  await openHydratedApp(page);
  await page
    .getByRole("checkbox", {
      name: /I understand this uses synthetic data and will not place a real call/,
    })
    .check();
  await page
    .getByRole("button", { name: "Start controlled rehearsal" })
    .click();

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Finish rehearsal" }).click();

  await expect(
    page.getByText("Simulated outcome recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No external call was placed", { exact: true }),
  ).toBeVisible();
});

test("keyboard controls move selection and focus predictably", async ({
  page,
}) => {
  await openHydratedApp(page);

  const choosePdf = page.getByRole("button", {
    name: "Choose PDF",
    exact: true,
  });
  await choosePdf.focus();
  await expect(choosePdf).toBeFocused();
  await expect(choosePdf).toHaveJSProperty("tagName", "BUTTON");

  const rheumatology = page.getByRole("radio", { name: /Rheumatology/ });
  const diabetes = page.getByRole("radio", { name: /Diabetes clinic/ });
  await rheumatology.focus();
  await rheumatology.press("ArrowRight");
  await expect(diabetes).toBeFocused();
  await expect(diabetes).toHaveAttribute("aria-checked", "true");

  const pageOne = page.getByRole("tab", { name: "Page 1" });
  const pageTwo = page.getByRole("tab", { name: "Page 2" });
  await pageOne.focus();
  await pageOne.press("End");
  await expect(pageTwo).toBeFocused();
  await expect(pageTwo).toHaveAttribute("aria-selected", "true");
  await pageTwo.press("Home");
  await expect(pageOne).toBeFocused();
  await expect(pageOne).toHaveAttribute("aria-selected", "true");

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Safety evidence" })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Designed to support administration, not make clinical decisions.",
    }),
  ).toBeFocused();
});

test("all hydrated views have no automated WCAG A or AA violations", async ({
  page,
}) => {
  await openHydratedApp(page);
  const views = [
    "Understand a letter",
    "My referrals",
    "Safety evidence",
    "Settings",
  ];

  for (const view of views) {
    const navigationButton = page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: view });
    await navigationButton.click();
    await expect(navigationButton).toHaveAttribute("aria-current", "page");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
      `${view} axe violations`,
    ).toEqual([]);
  }
});

test("mobile navigation exposes all four destinations without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHydratedApp(page);

  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  for (const name of [
    "Understand a letter",
    "My referrals",
    "Safety evidence",
    "Settings",
  ]) {
    await expect(navigation.getByRole("button", { name })).toBeInViewport();
  }
  await expect(
    page.getByRole("button", {
      name: "Verify supplied PDF",
      exact: true,
    }),
  ).toBeInViewport();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
});

test("layout reflows at widths equivalent to 200% and 400% browser zoom", async ({
  page,
}) => {
  for (const zoom of [2, 4]) {
    await page.setViewportSize({
      width: Math.round(1280 / zoom),
      height: 900,
    });
    await openHydratedApp(page);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      dimensions.scrollWidth,
      `${zoom * 100}% equivalent layout width`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expect(
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("button", { name: "Settings" }),
    ).toBeInViewport();
  }
});

test("the built production Worker fails closed without capability coordination", async ({
  request,
}) => {
  const response = await request.post("/api/providers/capability", {
    data: { action: "anthropic" },
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:4173",
    },
  });

  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const payload = (await response.json()) as {
    error?: { code?: string };
  };
  expect(payload.error?.code).toBe("capability_service_unavailable");
});

test("public assets retain exact MIME types and defensive headers", async ({
  request,
}) => {
  const assets = [
    ["/demo/rheumatology-referral-synthetic.pdf", "application/pdf", "%PDF"],
    ["/demo/rheumatology-page-1.png", "image/png", "\u0089PNG"],
    ["/demo/rheumatology-page-2.png", "image/png", "\u0089PNG"],
    ["/demo/rheumatology-fixture-manifest.json", "application/json", "{"],
    ["/care-relay-social-card.png", "image/png", "\u0089PNG"],
    ["/og.png", "image/png", "\u0089PNG"],
    ["/favicon.svg", "image/svg+xml", "<svg"],
  ] as const;

  for (const [path, mediaType, signature] of assets) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(
      new RegExp(
        `^${mediaType.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:;|$)`,
        "i",
      ),
    );
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
    expect(response.headers()["referrer-policy"], path).toBe("no-referrer");
    const body = await response.body();
    expect(body.byteLength, `${path} is non-empty`).toBeGreaterThan(8);
    expect(
      body.subarray(0, signature.length).toString("latin1"),
      `${path} magic bytes`,
    ).toBe(signature);
  }

  const traversal = await request.get("/demo/%2e%2e/package.json");
  expect(traversal.status()).toBe(404);
  expect(traversal.headers()["x-content-type-options"]).toBe("nosniff");

  const unusedImageOptimiser = await request.get(
    "/_vinext/image?url=/og.png&w=640&q=75",
  );
  expect(unusedImageOptimiser.status()).toBe(404);
  expect(unusedImageOptimiser.headers()["x-content-type-options"]).toBe(
    "nosniff",
  );
});
