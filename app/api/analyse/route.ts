import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  jsonResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import { askClaudeGrounded } from "@/lib/anthropic";
import { verifyAndConsumeDemoCapability } from "@/lib/demo-capability";
import { getFixture, isFixtureId } from "@/lib/fixtures";
import {
  deterministicAnswer,
  isAllowedAdministrativeQuestion,
  isUnsafeQuestion,
  resolveProviderIntent,
  safeAbstention,
  validateSelectedText,
} from "@/lib/grounding";
import { acquireCoordinatedMeteredPermit } from "@/lib/provider-abuse-control";
import { isProviderConfigured } from "@/lib/runtime-secrets";

export const ANALYSE_BODY_LIMIT = 16_384;

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    const body = await readJsonWithLimit<unknown>(request, ANALYSE_BODY_LIMIT);
    assertPlainObject(body);
    assertOnlyKeys(body, ["documentId", "question", "selectedText"]);

    if (!isFixtureId(body.documentId)) {
      throw new ApiError(
        "unknown_document",
        "The requested synthetic document is not available.",
        404,
      );
    }
    if (
      typeof body.question !== "string" ||
      body.question.trim().length < 2 ||
      body.question.length > 1_000
    ) {
      throw new ApiError(
        "invalid_question",
        "The question must contain 2 to 1,000 characters.",
        400,
      );
    }
    if (
      body.selectedText !== undefined &&
      (typeof body.selectedText !== "string" ||
        body.selectedText.length < 1 ||
        body.selectedText.length > 500)
    ) {
      throw new ApiError(
        "invalid_selected_text",
        "Selected text must contain 1 to 500 characters.",
        400,
      );
    }

    const fixture = getFixture(body.documentId);
    const selectedText =
      typeof body.selectedText === "string" ? body.selectedText : undefined;
    if (
      selectedText !== undefined &&
      !validateSelectedText(fixture, selectedText)
    ) {
      throw new ApiError(
        "selected_text_not_in_source",
        "The selected excerpt must occur exactly within one fixture passage.",
        422,
      );
    }

    if (isUnsafeQuestion(body.question)) {
      return jsonResponse(requestId, safeAbstention());
    }
    if (
      !isAllowedAdministrativeQuestion(
        fixture,
        body.question,
        selectedText,
      )
    ) {
      return jsonResponse(requestId, safeAbstention());
    }

    const localAnswer = deterministicAnswer(
      fixture,
      body.question,
      selectedText,
    );
    if (!localAnswer.abstained) {
      return jsonResponse(requestId, localAnswer);
    }
    if (
      !isProviderConfigured("anthropic") ||
      !request.headers.has("x-carerelay-capability")
    ) {
      return jsonResponse(requestId, localAnswer);
    }

    try {
      requireSameOrigin(request);
    } catch {
      return jsonResponse(requestId, localAnswer);
    }
    const capability = await verifyAndConsumeDemoCapability(
      request,
      "anthropic",
    );
    if (!capability.ok) {
      return jsonResponse(requestId, localAnswer);
    }
    const permit = await acquireCoordinatedMeteredPermit(
      "anthropic",
      capability.clientBinding,
    );
    if (!permit.ok) {
      return jsonResponse(requestId, localAnswer, {
        headers: { "Retry-After": String(permit.retryAfter) },
      });
    }
    try {
      const claude = await askClaudeGrounded(
        fixture,
        body.question,
        selectedText,
        request.signal,
      );
      return jsonResponse(
        requestId,
        claude.kind === "response"
          ? resolveProviderIntent(claude.value, fixture, selectedText)
          : localAnswer,
      );
    } finally {
      await permit.release();
    }
  });
}
