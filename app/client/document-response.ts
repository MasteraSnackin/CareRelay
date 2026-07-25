import type { Fixture } from "@/lib/fixtures";

export type CitationRectangle = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type UploadCitation = {
  id: string;
  page: number;
  passageId: string;
  quote: string;
  rectangles: CitationRectangle[];
};

export type VerifiedDocumentResponse = {
  citations: UploadCitation[];
  pages: Array<{ page: number; text: string }>;
  stages: string[];
};

const VERIFIED_STAGES = [
  { id: "upload", label: "Upload validated" },
  { id: "parse", label: "PDF parsed" },
  { id: "extract", label: "Text extracted" },
  {
    id: "synthetic-boundary",
    label: "Synthetic boundary verified",
  },
  { id: "fixture", label: "Known fixture matched" },
  { id: "citations", label: "Citations mapped" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function readNormalisedRectangle(value: unknown): CitationRectangle | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x > 1 ||
    y > 1 ||
    width > 1 ||
    height > 1 ||
    x + width > 1.001 ||
    y + height > 1.001
  ) {
    return null;
  }
  return { x, y, width, height };
}

function readPages(
  source: Record<string, unknown>,
  fixture: Fixture,
): Array<{ page: number; text: string }> | null {
  if (source.pageCount !== fixture.pages.length || !Array.isArray(source.pages)) {
    return null;
  }
  if (source.pages.length !== fixture.pages.length) return null;

  const pages = source.pages
    .map((value): { page: number; text: string } | null => {
      if (
        !isRecord(value) ||
        typeof value.page !== "number" ||
        typeof value.text !== "string" ||
        value.text.length === 0
      ) {
        return null;
      }
      return { page: value.page, text: value.text };
    })
    .filter((value): value is { page: number; text: string } => value !== null);

  if (
    pages.length !== fixture.pages.length ||
    pages.some((page, index) => page.page !== index + 1)
  ) {
    return null;
  }

  for (const passage of fixture.passages) {
    const page = pages.find((candidate) => candidate.page === passage.page);
    if (
      !page ||
      !normaliseWhitespace(page.text).includes(
        normaliseWhitespace(passage.text),
      )
    ) {
      return null;
    }
  }
  return pages;
}

function readStages(source: Record<string, unknown>): string[] | null {
  const verifiedStages = source.verifiedStages;
  if (
    !Array.isArray(verifiedStages) ||
    verifiedStages.length !== VERIFIED_STAGES.length
  ) {
    return null;
  }

  const valid = VERIFIED_STAGES.every((expected, index) => {
    const stage = verifiedStages[index];
    return (
      isRecord(stage) &&
      stage.id === expected.id &&
      stage.label === expected.label &&
      stage.verified === true &&
      Object.keys(stage).every((key) =>
        ["id", "label", "verified"].includes(key),
      )
    );
  });
  return valid ? VERIFIED_STAGES.map((stage) => stage.label) : null;
}

function hasExactVerification(source: Record<string, unknown>): boolean {
  const verification = source.verification;
  if (!isRecord(verification)) return false;
  const keys = [
    "pdfSignature",
    "fingerprint",
    "syntheticMarkers",
    "fixtureEvidence",
    "citationCoordinates",
  ];
  return (
    Object.keys(verification).length === keys.length &&
    keys.every((key) => verification[key] === true)
  );
}

function hasRequestOnlyPrivacy(source: Record<string, unknown>): boolean {
  if (!isRecord(source.privacy)) return false;
  return (
    source.privacy.storage === "none" &&
    source.privacy.retention === "request-only" &&
    source.privacy.uploadedBytesDiscarded === true
  );
}

function readCitations(
  source: Record<string, unknown>,
  fixture: Fixture,
): UploadCitation[] | null {
  if (
    !Array.isArray(source.citations) ||
    source.citations.length !== fixture.passages.length
  ) {
    return null;
  }

  const byPassage = new Map<string, UploadCitation>();
  for (const candidate of source.citations) {
    if (
      !isRecord(candidate) ||
      typeof candidate.passageId !== "string" ||
      typeof candidate.page !== "number" ||
      !Array.isArray(candidate.rects)
    ) {
      return null;
    }
    const passage = fixture.passages.find(
      (item) => item.id === candidate.passageId,
    );
    if (
      !passage ||
      passage.page !== candidate.page ||
      byPassage.has(passage.id) ||
      candidate.rects.length === 0
    ) {
      return null;
    }
    const rectangles = candidate.rects
      .map(readNormalisedRectangle)
      .filter(
        (rectangle): rectangle is CitationRectangle => rectangle !== null,
      );
    if (rectangles.length !== candidate.rects.length) return null;
    byPassage.set(passage.id, {
      id: passage.id,
      page: passage.page,
      passageId: passage.id,
      quote: passage.text,
      rectangles,
    });
  }

  const citations = fixture.passages
    .map((passage) => byPassage.get(passage.id))
    .filter(
      (citation): citation is UploadCitation => citation !== undefined,
    );
  return citations.length === fixture.passages.length ? citations : null;
}

export function verifyDocumentResponse(
  payload: unknown,
  fixture: Fixture,
): VerifiedDocumentResponse | null {
  const source =
    isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (
    !isRecord(source) ||
    fixture.id !== "rheumatology" ||
    source.fixtureId !== fixture.id
  ) {
    return null;
  }
  const pages = readPages(source, fixture);
  const stages = readStages(source);
  const citations = readCitations(source, fixture);
  if (
    !pages ||
    !stages ||
    !citations ||
    !hasExactVerification(source) ||
    !hasRequestOnlyPrivacy(source)
  ) {
    return null;
  }
  return { pages, stages, citations };
}

export const EXPECTED_UPLOAD_STAGE_LABELS = VERIFIED_STAGES.map(
  (stage) => stage.label,
);
