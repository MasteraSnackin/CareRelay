import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  jsonResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import { checkProviderReadiness } from "@/lib/provider-status";
import type { ProviderName } from "@/lib/runtime-secrets";

const PROVIDERS = new Set<ProviderName>([
  "anthropic",
  "elevenlabs",
  "twilio",
]);

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    requireSameOrigin(request);
    const body = await readJsonWithLimit<unknown>(request, 1_024);
    assertPlainObject(body);
    assertOnlyKeys(body, ["provider"]);
    if (
      typeof body.provider !== "string" ||
      !PROVIDERS.has(body.provider as ProviderName)
    ) {
      throw new ApiError(
        "unknown_provider",
        "Choose a supported provider.",
        400,
      );
    }
    const provider = body.provider as ProviderName;
    return jsonResponse(requestId, {
      provider: await checkProviderReadiness(provider),
    });
  });
}
