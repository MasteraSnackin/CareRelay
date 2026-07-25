import {
  MAX_MULTIPART_BYTES,
  MAX_PDF_BYTES,
  acquireDocumentAnalysisPermit,
  analyseKnownDocument,
} from "@/lib/document-analysis";
import {
  ApiError,
  handleApiRoute,
  jsonResponse,
  readBodyWithLimit,
} from "@/lib/api-response";

function isFileLike(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "name" in value &&
    typeof value.name === "string" &&
    "size" in value &&
    typeof value.size === "number" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

async function parseSinglePdf(request: Request): Promise<Uint8Array> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;\s*boundary=/iu.test(contentType)) {
    throw new ApiError(
      "unsupported_media_type",
      "Content-Type must be multipart/form-data with a boundary.",
      415,
    );
  }

  const body = await readBodyWithLimit(request, MAX_MULTIPART_BYTES, {
    timeoutMs: 10_000,
    signal: request.signal,
  });
  let form: FormData;
  try {
    const bodyCopy = new Uint8Array(body.byteLength);
    bodyCopy.set(body);
    form = await new Response(bodyCopy.buffer, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new ApiError(
      "invalid_multipart",
      "The multipart document request could not be read.",
      400,
    );
  }

  const entries = [...form.entries()];
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "document" ||
    !isFileLike(entries[0][1])
  ) {
    throw new ApiError(
      "invalid_document_field",
      'Submit exactly one PDF in the field named "document".',
      400,
    );
  }

  const file = entries[0][1];
  if (file.size === 0) {
    throw new ApiError("document_empty", "The PDF is empty.", 400);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new ApiError(
      "document_too_large",
      "The PDF exceeds the 4 MiB document limit.",
      413,
    );
  }
  if (file.type.toLowerCase() !== "application/pdf") {
    throw new ApiError(
      "invalid_document_type",
      "The document must use the application/pdf media type.",
      415,
    );
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new ApiError(
      "invalid_document_extension",
      "The document filename must end in .pdf.",
      400,
    );
  }
  return new Uint8Array(await file.arrayBuffer());
}

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    const bytes = await parseSinglePdf(request);
    const release = acquireDocumentAnalysisPermit();
    if (!release) {
      throw new ApiError(
        "analysis_in_progress",
        "Another document is being analysed. Wait for it to finish before trying again.",
        409,
      );
    }
    try {
      const result = await analyseKnownDocument(bytes, {
        timeoutMs: 8_000,
        signal: request.signal,
      });
      return jsonResponse(requestId, result);
    } finally {
      release();
    }
  });
}
