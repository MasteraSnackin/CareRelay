import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import type { StructuredTextItem } from "unpdf";

export const MAX_PDF_PAGES = 6;
export const MAX_PAGE_TEXT_CHARACTERS = 25_000;
export const MAX_DOCUMENT_TEXT_CHARACTERS = 80_000;
export const DEFAULT_PDF_ANALYSIS_TIMEOUT_MS = 8_000;

export interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedPdfPage {
  page: number;
  text: string;
  width: number;
  height: number;
  items: ExtractedTextItem[];
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPdfPage[];
}

export interface NormalisedRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PassageCoordinates {
  passageId: string;
  page: number;
  rects: NormalisedRectangle[];
}

export class PdfExtractionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfExtractionError";
    this.code = code;
  }
}

export function normalisePdfWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function analysisTimedOut(): PdfExtractionError {
  return new PdfExtractionError(
    "pdf_analysis_timeout",
    "PDF analysis did not finish within the permitted time.",
  );
}

function withAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(analysisTimedOut());

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(analysisTimedOut());
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanItem(item: StructuredTextItem): ExtractedTextItem | undefined {
  const text = normalisePdfWhitespace(item.str);
  if (
    !text ||
    !Number.isFinite(item.x) ||
    !Number.isFinite(item.y) ||
    !Number.isFinite(item.width) ||
    !Number.isFinite(item.height)
  ) {
    return undefined;
  }
  return {
    text,
    x: item.x,
    y: item.y,
    width: Math.max(0, item.width),
    height: Math.max(0, item.height),
  };
}

export async function extractPdf(
  bytes: Uint8Array,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ExtractedPdf> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    if (signal?.aborted) {
      throw analysisTimedOut();
    }
    // PDF.js verbosity level 0 emits errors only. This prevents unstructured
    // parser warnings (which can contain document-derived data) from reaching
    // application logs.
    const proxyOperation = getDocumentProxy(bytes, { verbosity: 0 });
    // If the parser resolves after the caller has already timed out, dispose
    // its loading task rather than retaining parser resources.
    if (signal) {
      void proxyOperation.then(
        (candidate) => {
          if (signal.aborted) {
            void candidate.loadingTask.destroy().catch(() => undefined);
          }
        },
        () => undefined,
      );
    }
    pdf = await withAbort(proxyOperation, signal);
    abortHandler = () => {
      void pdf?.loadingTask.destroy().catch(() => undefined);
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) {
      abortHandler();
      throw analysisTimedOut();
    }
    if (pdf.numPages < 1) {
      throw new PdfExtractionError("pdf_empty", "The PDF does not contain a page.");
    }
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfExtractionError(
        "pdf_page_limit",
        `The PDF contains more than ${MAX_PDF_PAGES} pages.`,
      );
    }

    const extractedText = await withAbort(
      extractText(pdf, { mergePages: false }),
      signal,
    );
    const extractedItems = await withAbort(extractTextItems(pdf), signal);
    if (
      extractedText.totalPages !== pdf.numPages ||
      extractedItems.totalPages !== pdf.numPages ||
      !Array.isArray(extractedText.text)
    ) {
      throw new PdfExtractionError(
        "pdf_extraction_incomplete",
        "The PDF could not be extracted consistently.",
      );
    }

    let documentCharacters = 0;
    const pages: ExtractedPdfPage[] = [];
    for (let index = 0; index < pdf.numPages; index += 1) {
      const pageText = extractedText.text[index] ?? "";
      if (pageText.length > MAX_PAGE_TEXT_CHARACTERS) {
        throw new PdfExtractionError(
          "pdf_page_text_limit",
          `A PDF page exceeds the ${MAX_PAGE_TEXT_CHARACTERS}-character text limit.`,
        );
      }
      documentCharacters += pageText.length;
      if (documentCharacters > MAX_DOCUMENT_TEXT_CHARACTERS) {
        throw new PdfExtractionError(
          "pdf_document_text_limit",
          `The PDF exceeds the ${MAX_DOCUMENT_TEXT_CHARACTERS}-character text limit.`,
        );
      }

      const pageProxy = await withAbort(pdf.getPage(index + 1), signal);
      const viewport = pageProxy.getViewport({ scale: 1 });
      const items = (extractedItems.items[index] ?? [])
        .map(cleanItem)
        .filter((item): item is ExtractedTextItem => item !== undefined);

      pages.push({
        page: index + 1,
        text: pageText,
        width: finitePositive(viewport.width, 1),
        height: finitePositive(viewport.height, 1),
        items,
      });
      pageProxy.cleanup();
    }

    return { pageCount: pdf.numPages, pages };
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      throw error;
    }
    if (signal?.aborted) {
      throw analysisTimedOut();
    }
    throw new PdfExtractionError(
      "pdf_parse_failed",
      "The file could not be parsed as a PDF.",
    );
  } finally {
    if (abortHandler) {
      signal?.removeEventListener("abort", abortHandler);
    }
    if (pdf) {
      await pdf.loadingTask.destroy().catch(() => undefined);
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface ItemSpan {
  item: ExtractedTextItem;
  start: number;
  end: number;
}

function searchableItems(items: ExtractedTextItem[]): {
  text: string;
  spans: ItemSpan[];
} {
  let text = "";
  const spans: ItemSpan[] = [];
  for (const item of items) {
    if (text) {
      text += " ";
    }
    const start = text.length;
    text += item.text;
    spans.push({ item, start, end: text.length });
  }
  return { text, spans };
}

function rectangleForOverlap(
  page: ExtractedPdfPage,
  span: ItemSpan,
  matchStart: number,
  matchEnd: number,
): NormalisedRectangle | undefined {
  const overlapStart = Math.max(span.start, matchStart);
  const overlapEnd = Math.min(span.end, matchEnd);
  if (overlapStart >= overlapEnd || span.item.text.length === 0) {
    return undefined;
  }

  const localStart = clamp(
    (overlapStart - span.start) / span.item.text.length,
    0,
    1,
  );
  const localEnd = clamp(
    (overlapEnd - span.start) / span.item.text.length,
    localStart,
    1,
  );
  const x = span.item.x + span.item.width * localStart;
  const width = span.item.width * (localEnd - localStart);
  const top = page.height - (span.item.y + span.item.height);
  const normalised = {
    x: clamp(x / page.width, 0, 1),
    y: clamp(top / page.height, 0, 1),
    width: clamp(width / page.width, 0, 1),
    height: clamp(span.item.height / page.height, 0, 1),
  };
  if (normalised.width <= 0 || normalised.height <= 0) {
    return undefined;
  }
  normalised.width = Math.min(normalised.width, 1 - normalised.x);
  normalised.height = Math.min(normalised.height, 1 - normalised.y);
  return normalised;
}

export function mapPassageCoordinates(
  page: ExtractedPdfPage,
  passageId: string,
  exactPassageText: string,
): PassageCoordinates | undefined {
  const needle = normalisePdfWhitespace(exactPassageText);
  const searchable = searchableItems(page.items);
  const matchStart = searchable.text.indexOf(needle);
  if (matchStart < 0) {
    return undefined;
  }
  const matchEnd = matchStart + needle.length;
  const rects = searchable.spans
    .map((span) => rectangleForOverlap(page, span, matchStart, matchEnd))
    .filter((rectangle): rectangle is NormalisedRectangle => rectangle !== undefined);

  if (rects.length === 0) {
    return undefined;
  }
  return {
    passageId,
    page: page.page,
    rects,
  };
}
