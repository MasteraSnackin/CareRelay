import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  mediaResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import { verifyAndConsumeDemoCapability } from "@/lib/demo-capability";
import {
  resolveApprovedSpeech,
  synthesiseApprovedSpeech,
} from "@/lib/elevenlabs";
import { isFixtureId } from "@/lib/fixtures";
import { acquireCoordinatedMeteredPermit } from "@/lib/provider-abuse-control";

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    const body = await readJsonWithLimit<unknown>(request, 1_024);
    assertPlainObject(body);
    assertOnlyKeys(body, ["fixtureId", "speechId"]);
    if (!isFixtureId(body.fixtureId) || typeof body.speechId !== "string") {
      throw new ApiError(
        "invalid_speech_request",
        "Choose an approved synthetic speech item.",
        400,
      );
    }
    if (!resolveApprovedSpeech(body.fixtureId, body.speechId)) {
      throw new ApiError(
        "speech_not_approved",
        "The speech identifier is not approved for this synthetic fixture.",
        400,
      );
    }
    requireSameOrigin(request);
    const capability = await verifyAndConsumeDemoCapability(
      request,
      "elevenlabs",
    );
    if (!capability.ok) {
      throw new ApiError(
        "provider_capability_required",
        "A fresh server-issued speech capability is required.",
        403,
      );
    }
    const permit = await acquireCoordinatedMeteredPermit(
      "elevenlabs",
      capability.clientBinding,
    );
    if (!permit.ok) {
      if (permit.reason === "coordination-unavailable") {
        throw new ApiError(
          "voice_coordination_unavailable",
          "Distributed provider quota coordination is not configured. Use device speech instead.",
          503,
          { "Retry-After": String(permit.retryAfter) },
        );
      }
      throw new ApiError(
        "voice_rate_limited",
        "Approved provider speech is temporarily rate limited. Use device speech instead.",
        429,
        { "Retry-After": String(permit.retryAfter) },
      );
    }
    try {
      const result = await synthesiseApprovedSpeech(
        body.fixtureId,
        body.speechId,
        fetch,
        { signal: request.signal },
      );
      const audio = new Uint8Array(result.bytes.byteLength);
      audio.set(result.bytes);
      return mediaResponse(requestId, audio.buffer, result.contentType, {
        headers: { "Content-Language": result.language },
      });
    } catch {
      throw new ApiError(
        "voice_unavailable",
        "Provider speech is unavailable. Use device speech instead.",
        503,
      );
    } finally {
      await permit.release();
    }
  });
}
