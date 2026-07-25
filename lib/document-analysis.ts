import { ApiError } from "./api-response";
import {
  FIXTURES,
  SYNTHETIC_NOTICE,
  type FixturePassage,
} from "./fixtures";
import {
  extractPdf,
  DEFAULT_PDF_ANALYSIS_TIMEOUT_MS,
  mapPassageCoordinates,
  normalisePdfWhitespace,
  PdfExtractionError,
  type PassageCoordinates,
} from "./pdf-extraction";

export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_PDF_BYTES + 256 * 1024;

/**
 * Replace this constant only when the deterministic fixture asset is
 * deliberately regenerated and its extraction/citation tests also pass.
 */
export const EXPECTED_RHEUMATOLOGY_PDF_SHA256 =
  "87a10dfd1401f6ee538a74aa1ffa767b1b6fcf3426fe0938335a16242f2d0924";

export const REQUIRED_SYNTHETIC_MARKERS = [
  SYNTHETIC_NOTICE,
  "INDEPENDENT SYNTHETIC DOCUMENT - NO REAL PATIENT",
] as const;

export const VERIFIED_STAGES = [
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
] as const;

const ANALYSIS_GUARD_SYMBOL = Symbol.for("carerelay.document-analysis-guard");

function analysisGuard(): { inFlight: boolean } {
  const target = globalThis as typeof globalThis & {
    [ANALYSIS_GUARD_SYMBOL]?: { inFlight: boolean };
  };
  target[ANALYSIS_GUARD_SYMBOL] ??= { inFlight: false };
  return target[ANALYSIS_GUARD_SYMBOL];
}

export function acquireDocumentAnalysisPermit(): (() => void) | undefined {
  const guard = analysisGuard();
  if (guard.inFlight) {
    return undefined;
  }
  guard.inFlight = true;
  let active = true;
  return () => {
    if (active) {
      guard.inFlight = false;
      active = false;
    }
  };
}

export function resetDocumentAnalysisGuard(): void {
  analysisGuard().inFlight = false;
}

export interface DocumentAnalysisResult {
  fixtureId: "rheumatology";
  pageCount: number;
  pages: Array<{ page: number; text: string }>;
  verifiedStages: Array<{
    id: string;
    label: string;
    verified: true;
  }>;
  verification: {
    pdfSignature: true;
    fingerprint: true;
    syntheticMarkers: true;
    fixtureEvidence: true;
    citationCoordinates: true;
  };
  citations: PassageCoordinates[];
  privacy: {
    storage: "none";
    retention: "request-only";
    uploadedBytesDiscarded: true;
  };
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function pageContainsPassage(
  pages: Array<{ page: number; text: string }>,
  passage: FixturePassage,
): boolean {
  const page = pages.find((candidate) => candidate.page === passage.page);
  return (
    page !== undefined &&
    normalisePdfWhitespace(page.text).includes(
      normalisePdfWhitespace(passage.text),
    )
  );
}

export async function analyseKnownDocument(
  bytes: Uint8Array,
  {
    timeoutMs = DEFAULT_PDF_ANALYSIS_TIMEOUT_MS,
    signal,
  }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DocumentAnalysisResult> {
  if (bytes.byteLength === 0) {
    throw new ApiError("document_empty", "The PDF is empty.", 400);
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new ApiError(
      "document_too_large",
      "The PDF exceeds the 4 MiB document limit.",
      413,
    );
  }
  if (!hasPdfSignature(bytes)) {
    throw new ApiError(
      "invalid_pdf_signature",
      "The file does not have a valid PDF signature.",
      400,
    );
  }

  // Reject unknown bytes before invoking the comparatively expensive parser.
  // unpdf may transfer and detach its input buffer, so the hash must also be
  // calculated before extraction.
  const fingerprint = await sha256Hex(bytes);
  if (fingerprint !== EXPECTED_RHEUMATOLOGY_PDF_SHA256) {
    throw new ApiError(
      "unrecognised_document",
      "Only the exact supplied synthetic rheumatology PDF is accepted.",
      422,
    );
  }

  let extracted;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  ) {
    throw new ApiError(
      "invalid_analysis_timeout",
      "The PDF-analysis timeout is invalid.",
      500,
    );
  }
  const analysisController = new AbortController();
  const propagateAbort = () => analysisController.abort();
  if (signal?.aborted) propagateAbort();
  signal?.addEventListener("abort", propagateAbort, { once: true });
  const timeout = setTimeout(() => analysisController.abort(), timeoutMs);
  try {
    extracted = await extractPdf(bytes, {
      signal: analysisController.signal,
    });
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      const status =
        error.code === "pdf_analysis_timeout"
          ? 408
          : error.code.endsWith("_limit") ||
              error.code === "pdf_page_limit"
            ? 413
            : 422;
      throw new ApiError(error.code, error.message, status);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", propagateAbort);
  }

  const normalisedDocumentText = extracted.pages
    .map((page) => normalisePdfWhitespace(page.text))
    .join(" ");
  if (
    !REQUIRED_SYNTHETIC_MARKERS.every((marker) =>
      normalisedDocumentText.includes(normalisePdfWhitespace(marker)),
    )
  ) {
    throw new ApiError(
      "synthetic_markers_missing",
      "The required synthetic-document notices were not found.",
      422,
    );
  }

  const fixture = FIXTURES.rheumatology;
  if (
    extracted.pageCount !== fixture.pages.length ||
    !fixture.passages.every((passage) =>
      pageContainsPassage(extracted.pages, passage),
    )
  ) {
    throw new ApiError(
      "fixture_evidence_mismatch",
      "The PDF does not contain the expected synthetic fixture evidence.",
      422,
    );
  }

  const citations: PassageCoordinates[] = [];
  for (const passage of fixture.passages) {
    const page = extracted.pages[passage.page - 1];
    const coordinates =
      page && mapPassageCoordinates(page, passage.id, passage.text);
    if (!coordinates) {
      throw new ApiError(
        "citation_mapping_failed",
        "Trustworthy source coordinates could not be produced for every passage.",
        422,
      );
    }
    citations.push(coordinates);
  }

  return {
    fixtureId: "rheumatology",
    pageCount: extracted.pageCount,
    pages: extracted.pages.map(({ page, text }) => ({ page, text })),
    verifiedStages: VERIFIED_STAGES.map((stage) => ({ ...stage })),
    verification: {
      pdfSignature: true,
      fingerprint: true,
      syntheticMarkers: true,
      fixtureEvidence: true,
      citationCoordinates: true,
    },
    citations,
    privacy: {
      storage: "none",
      retention: "request-only",
      uploadedBytesDiscarded: true,
    },
  };
}
