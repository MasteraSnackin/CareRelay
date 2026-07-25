import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { POST as uploadDocument } from "../app/api/documents/route";
import {
  EXPECTED_RHEUMATOLOGY_PDF_SHA256,
  MAX_MULTIPART_BYTES,
  MAX_PDF_BYTES,
  VERIFIED_STAGES,
  acquireDocumentAnalysisPermit,
  analyseKnownDocument,
  hasPdfSignature,
  resetDocumentAnalysisGuard,
  sha256Hex,
} from "../lib/document-analysis";
import { FIXTURES } from "../lib/fixtures";
import {
  MAX_DOCUMENT_TEXT_CHARACTERS,
  MAX_PAGE_TEXT_CHARACTERS,
  PdfExtractionError,
  extractPdf,
  mapPassageCoordinates,
  normalisePdfWhitespace,
} from "../lib/pdf-extraction";
import { ApiError } from "../lib/api-response";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureUrl = new URL(
  "../public/demo/rheumatology-referral-synthetic.pdf",
  import.meta.url,
);

async function fixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixtureUrl));
}

function concreteBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function makePdf(pageTexts: readonly string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = document.addPage([595.28, 841.89]);
    page.drawText(text, { x: 30, y: 800, font, size: 8 });
  }
  return document.save({ useObjectStreams: false });
}

async function makeDenseTextPdf(
  lineCounts: readonly number[],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const lineCount of lineCounts) {
    const page = document.addPage([595.28, 841.89]);
    for (let index = 0; index < lineCount; index += 1) {
      page.drawText("word ".repeat(20), {
        x: 20,
        y: 820 - index * 3,
        font,
        size: 1,
      });
    }
  }
  return document.save({ useObjectStreams: false });
}

function multipartRequest(form: FormData): Request {
  return new Request("https://care-relay.test/api/documents", {
    method: "POST",
    headers: { "x-request-id": "document-upload-test" },
    body: form,
  });
}

async function responseErrorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test("the checked-in fixture and generator reproduce the expected fingerprint", async () => {
  const bytes = await fixtureBytes();
  assert.equal(hasPdfSignature(bytes), true);
  assert.equal(
    await sha256Hex(bytes),
    EXPECTED_RHEUMATOLOGY_PDF_SHA256,
  );
  assert.equal(
    EXPECTED_RHEUMATOLOGY_PDF_SHA256,
    "87a10dfd1401f6ee538a74aa1ffa767b1b6fcf3426fe0938335a16242f2d0924",
  );

  const check = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/generate-fixture.ts", "--check"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /CareRelay fixture (?:set verified|reproducible)/);
  assert.match(check.stdout, new RegExp(EXPECTED_RHEUMATOLOGY_PDF_SHA256));
});

test("extracts the real two-page PDF and verifies every required citation", async () => {
  const bytes = await fixtureBytes();
  const result = await analyseKnownDocument(bytes);

  assert.equal(result.fixtureId, "rheumatology");
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.verifiedStages.map(({ label }) => label),
    VERIFIED_STAGES.map(({ label }) => label),
  );
  assert.equal(result.verifiedStages.length, 6);
  assert.deepEqual(result.verification, {
    pdfSignature: true,
    fingerprint: true,
    syntheticMarkers: true,
    fixtureEvidence: true,
    citationCoordinates: true,
  });
  assert.deepEqual(result.privacy, {
    storage: "none",
    retention: "request-only",
    uploadedBytesDiscarded: true,
  });

  const fixture = FIXTURES.rheumatology;
  assert.equal(result.citations.length, fixture.passages.length);
  for (const passage of fixture.passages) {
    const page = result.pages.find((candidate) => candidate.page === passage.page);
    assert.ok(page);
    assert.ok(
      normalisePdfWhitespace(page.text).includes(
        normalisePdfWhitespace(passage.text),
      ),
      passage.id,
    );

    const citation = result.citations.find(
      (candidate) => candidate.passageId === passage.id,
    );
    assert.ok(citation, passage.id);
    assert.equal(citation.page, passage.page);
    assert.ok(citation.rects.length >= 1);
    for (const rectangle of citation.rects) {
      assert.ok(rectangle.x >= 0 && rectangle.x < 1);
      assert.ok(rectangle.y >= 0 && rectangle.y < 1);
      assert.ok(rectangle.width > 0 && rectangle.width <= 1 - rectangle.x);
      assert.ok(rectangle.height > 0 && rectangle.height <= 1 - rectangle.y);
    }
  }
});

test("maps wrapped passages to every contributing source rectangle", async () => {
  const extracted = await extractPdf(await fixtureBytes());
  const passage = FIXTURES.rheumatology.passages.find(
    ({ id }) => id === "rheumatology:p2:follow-up",
  );
  assert.ok(passage);

  const mapped = mapPassageCoordinates(
    extracted.pages[1]!,
    passage.id,
    passage.text,
  );
  assert.ok(mapped);
  assert.equal(mapped.page, 2);
  assert.equal(mapped.rects.length, 2);

  assert.equal(
    mapPassageCoordinates(extracted.pages[0]!, passage.id, passage.text),
    undefined,
  );
});

test("rejects altered fixture bytes before presenting them as verified", async () => {
  const altered = await fixtureBytes();
  const metadata = new TextEncoder().encode("D:20260622090000Z");
  const metadataIndex = Buffer.from(altered).indexOf(Buffer.from(metadata));
  assert.ok(metadataIndex > 4);
  // Alter fixed metadata while preserving the PDF structure and fixture evidence.
  altered[metadataIndex + 3]! = "7".charCodeAt(0);

  await assert.rejects(
    analyseKnownDocument(altered),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "unrecognised_document" &&
      error.status === 422,
  );

  // A signed but malformed unknown PDF is rejected by the fingerprint gate,
  // before PDF.js is allowed to parse it.
  await assert.rejects(
    analyseKnownDocument(
      new TextEncoder().encode("%PDF PRIVATE-SENTINEL malformed"),
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "unrecognised_document" &&
      error.status === 422,
  );
});

test("rejects empty, non-PDF and oversized input", async () => {
  await assert.rejects(
    analyseKnownDocument(new Uint8Array()),
    (error: unknown) =>
      error instanceof ApiError && error.code === "document_empty",
  );
  await assert.rejects(
    analyseKnownDocument(new TextEncoder().encode("not a PDF")),
    (error: unknown) =>
      error instanceof ApiError && error.code === "invalid_pdf_signature",
  );

  const oversized = new Uint8Array(MAX_PDF_BYTES + 1);
  oversized.set(new TextEncoder().encode("%PDF"), 0);
  await assert.rejects(
    analyseKnownDocument(oversized),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "document_too_large" &&
      error.status === 413,
  );
});

test("the real extractor rejects malformed PDFs and more than six pages", async () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...values: unknown[]) => {
    warnings.push(values);
  };
  try {
    await assert.rejects(
      extractPdf(
        new TextEncoder().encode(
          "%PDF PRIVATE-DOCUMENT-SENTINEL malformed",
        ),
      ),
      (error: unknown) =>
        error instanceof PdfExtractionError &&
        error.code === "pdf_parse_failed" &&
        !error.message.includes("PRIVATE-DOCUMENT-SENTINEL"),
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, []);

  const sevenPages = await makePdf(["1", "2", "3", "4", "5", "6", "7"]);
  await assert.rejects(
    extractPdf(sevenPages),
    (error: unknown) =>
      error instanceof PdfExtractionError && error.code === "pdf_page_limit",
  );
});

test("PDF analysis honours an abort deadline with a normalised error", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    analyseKnownDocument(await fixtureBytes(), {
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "pdf_analysis_timeout" &&
      error.status === 408,
  );
});

test("the real extractor enforces per-page and whole-document text limits", async () => {
  assert.equal(MAX_PAGE_TEXT_CHARACTERS, 25_000);
  const overPageLimit = await makeDenseTextPdf([260]);
  await assert.rejects(
    extractPdf(overPageLimit),
    (error: unknown) =>
      error instanceof PdfExtractionError &&
      error.code === "pdf_page_text_limit",
  );

  assert.equal(MAX_DOCUMENT_TEXT_CHARACTERS, 80_000);
  const overDocumentLimit = await makeDenseTextPdf([210, 210, 210, 210]);
  await assert.rejects(
    extractPdf(overDocumentLimit),
    (error: unknown) =>
      error instanceof PdfExtractionError &&
      error.code === "pdf_document_text_limit",
  );
});

test("the upload route accepts exactly the supplied fixture and never returns its filename", async () => {
  resetDocumentAnalysisGuard();
  const form = new FormData();
  form.append(
    "document",
    new Blob([concreteBuffer(await fixtureBytes())], {
      type: "application/pdf",
    }),
    "a-browser-supplied-name.pdf",
  );
  const response = await uploadDocument(multipartRequest(form));
  const text = await response.text();

  assert.equal(response.status, 200, text);
  assert.equal(response.headers.get("x-request-id"), "document-upload-test");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(text, /a-browser-supplied-name\.pdf/);
  const result = JSON.parse(text) as { fixtureId: string; pageCount: number };
  assert.deepEqual(result, {
    ...JSON.parse(text),
    fixtureId: "rheumatology",
    pageCount: 2,
  });
});

test("the upload route requires exactly one field named document", async () => {
  resetDocumentAnalysisGuard();
  const bytes = await fixtureBytes();

  const wrongName = new FormData();
  wrongName.append(
    "file",
    new Blob([concreteBuffer(bytes)], { type: "application/pdf" }),
    "fixture.pdf",
  );
  const wrongNameResponse = await uploadDocument(multipartRequest(wrongName));
  assert.equal(wrongNameResponse.status, 400);
  assert.equal(
    await responseErrorCode(wrongNameResponse),
    "invalid_document_field",
  );

  const additional = new FormData();
  additional.append(
    "document",
    new Blob([concreteBuffer(bytes)], { type: "application/pdf" }),
    "fixture.pdf",
  );
  additional.append("extra", "not allowed");
  const additionalResponse = await uploadDocument(multipartRequest(additional));
  assert.equal(additionalResponse.status, 400);
  assert.equal(
    await responseErrorCode(additionalResponse),
    "invalid_document_field",
  );

  const duplicate = new FormData();
  duplicate.append(
    "document",
    new Blob([concreteBuffer(bytes)], { type: "application/pdf" }),
    "one.pdf",
  );
  duplicate.append(
    "document",
    new Blob([concreteBuffer(bytes)], { type: "application/pdf" }),
    "two.pdf",
  );
  const duplicateResponse = await uploadDocument(multipartRequest(duplicate));
  assert.equal(duplicateResponse.status, 400);
  assert.equal(
    await responseErrorCode(duplicateResponse),
    "invalid_document_field",
  );
});

test("the upload route enforces PDF media type, extension and signature", async () => {
  resetDocumentAnalysisGuard();
  const bytes = await fixtureBytes();

  const badType = new FormData();
  badType.append(
    "document",
    new Blob([concreteBuffer(bytes)], { type: "application/octet-stream" }),
    "fixture.pdf",
  );
  const badTypeResponse = await uploadDocument(multipartRequest(badType));
  assert.equal(badTypeResponse.status, 415);
  assert.equal(await responseErrorCode(badTypeResponse), "invalid_document_type");

  const badExtension = new FormData();
  badExtension.append(
    "document",
    new Blob([concreteBuffer(bytes)], { type: "application/pdf" }),
    "fixture.txt",
  );
  const badExtensionResponse = await uploadDocument(
    multipartRequest(badExtension),
  );
  assert.equal(badExtensionResponse.status, 400);
  assert.equal(
    await responseErrorCode(badExtensionResponse),
    "invalid_document_extension",
  );

  const badSignature = new FormData();
  badSignature.append(
    "document",
    new Blob(["not a PDF"], { type: "application/pdf" }),
    "fixture.pdf",
  );
  const badSignatureResponse = await uploadDocument(
    multipartRequest(badSignature),
  );
  assert.equal(badSignatureResponse.status, 400);
  assert.equal(
    await responseErrorCode(badSignatureResponse),
    "invalid_pdf_signature",
  );
});

test("the upload route stream-limits multipart bodies without Content-Length", async () => {
  resetDocumentAnalysisGuard();
  const oversized = new Uint8Array(MAX_MULTIPART_BYTES + 1);
  const request = new Request("https://care-relay.test/api/documents", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=controlled-test-boundary",
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await uploadDocument(request);
  assert.equal(response.status, 413);
  assert.equal(await responseErrorCode(response), "request_body_too_large");
});

test("a second concurrent upload is rejected and a failed attempt releases the permit", async () => {
  resetDocumentAnalysisGuard();
  const release = acquireDocumentAnalysisPermit();
  assert.ok(release);

  const invalidWhileBusy = new FormData();
  invalidWhileBusy.append("wrong-field", "not a PDF");
  const invalidResponse = await uploadDocument(
    multipartRequest(invalidWhileBusy),
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(
    await responseErrorCode(invalidResponse),
    "invalid_document_field",
  );

  const blockedForm = new FormData();
  blockedForm.append(
    "document",
    new Blob([concreteBuffer(await fixtureBytes())], {
      type: "application/pdf",
    }),
    "fixture.pdf",
  );
  const blocked = await uploadDocument(multipartRequest(blockedForm));
  assert.equal(blocked.status, 409);
  assert.equal(await responseErrorCode(blocked), "analysis_in_progress");
  release();

  const invalid = new FormData();
  invalid.append(
    "document",
    new Blob(["not a PDF"], { type: "application/pdf" }),
    "fixture.pdf",
  );
  const failed = await uploadDocument(multipartRequest(invalid));
  assert.equal(failed.status, 400);
  const afterFailure = acquireDocumentAnalysisPermit();
  assert.ok(afterFailure);
  afterFailure();
});
