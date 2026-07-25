import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  jsonResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import { verifyAndConsumeDemoCapability } from "@/lib/demo-capability";
import { isTwilioLiveCallReady } from "@/lib/runtime-secrets";
import { acquireCoordinatedTwilioCallPermit } from "@/lib/twilio-call-guard";
import { queueControlledTwilioCall } from "@/lib/twilio";

export const CALL_BODY_LIMIT = 512;

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    requireSameOrigin(request);
    const body = await readJsonWithLimit<unknown>(request, CALL_BODY_LIMIT);
    assertPlainObject(body);
    assertOnlyKeys(body, ["consent"]);
    if (body.consent !== true || Object.keys(body).length !== 1) {
      throw new ApiError(
        "consent_required",
        "Separate explicit consent is required for the controlled provider call.",
        400,
      );
    }
    if (!isTwilioLiveCallReady()) {
      throw new ApiError(
        "live_calls_locked",
        "Controlled provider calling is locked until every fixed setting is configured and live calls are enabled.",
        503,
      );
    }
    const capability = await verifyAndConsumeDemoCapability(
      request,
      "twilio",
    );
    if (!capability.ok) {
      throw new ApiError(
        "provider_capability_required",
        "A fresh server-issued controlled-call capability is required.",
        403,
      );
    }

    const permit = await acquireCoordinatedTwilioCallPermit();
    if (!permit.ok) {
      if (permit.reason === "coordination-unavailable") {
        throw new ApiError(
          "call_coordination_unavailable",
          "Distributed call coordination is not configured. Live calls remain locked.",
          503,
          { "Retry-After": String(permit.retryAfter) },
        );
      }
      throw new ApiError(
        "call_rate_limited",
        "A controlled call is already in progress or cooling down.",
        429,
        { "Retry-After": String(permit.retryAfter) },
      );
    }

    let providerAcceptedQueue = false;
    try {
      const call = await queueControlledTwilioCall(fetch, {
        signal: request.signal,
      });
      if (call.status !== "queued") {
        throw new Error("Provider did not queue the call.");
      }
      providerAcceptedQueue = true;
      try {
        await permit.queued();
      } catch {
        await permit.release().catch(() => undefined);
        throw new ApiError(
          "call_state_uncertain",
          "The provider accepted the call request, but its safety cooldown could not be confirmed. Do not retry the call.",
          502,
        );
      }
      return jsonResponse(
        requestId,
        {
          status: "queued",
          message:
            "The fixed synthetic provider call was queued. This does not confirm that it rang, was answered or completed.",
        },
        { status: 202 },
      );
    } catch (error) {
      if (!providerAcceptedQueue) {
        await permit.release().catch(() => undefined);
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        "call_provider_failed",
        "The controlled provider call could not be queued.",
        502,
      );
    }
  });
}
