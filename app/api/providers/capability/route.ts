import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  jsonResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import {
  demoClientBinding,
  issueDemoCapability,
  isDemoCapabilityConfigured,
  type DemoCapabilityAction,
} from "@/lib/demo-capability";
import { acquireCoordinatedMeteredPermit } from "@/lib/provider-abuse-control";

const ACTIONS = new Set<DemoCapabilityAction>([
  "anthropic",
  "elevenlabs",
  "twilio",
]);

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    requireSameOrigin(request);
    const body = await readJsonWithLimit<unknown>(request, 512);
    assertPlainObject(body);
    assertOnlyKeys(body, ["action", "consent"]);
    if (
      typeof body.action !== "string" ||
      !ACTIONS.has(body.action as DemoCapabilityAction)
    ) {
      throw new ApiError(
        "invalid_capability_action",
        "Choose a supported bounded provider action.",
        400,
      );
    }
    const action = body.action as DemoCapabilityAction;
    if (
      (action === "twilio" && body.consent !== true) ||
      (action !== "twilio" && body.consent !== undefined)
    ) {
      throw new ApiError(
        "invalid_capability_consent",
        "Separate explicit consent is required only for the controlled call capability.",
        400,
      );
    }
    if (!isDemoCapabilityConfigured()) {
      throw new ApiError(
        "capability_service_unavailable",
        "Provider capabilities are not configured for this environment.",
        503,
      );
    }

    const clientBinding = await demoClientBinding(request);
    const permit = await acquireCoordinatedMeteredPermit(
      "capability",
      clientBinding,
    );
    if (!permit.ok) {
      if (permit.reason === "coordination-unavailable") {
        throw new ApiError(
          "capability_coordination_unavailable",
          "Distributed provider quota coordination is not configured.",
          503,
          { "Retry-After": String(permit.retryAfter) },
        );
      }
      throw new ApiError(
        "capability_rate_limited",
        "Too many capability requests. Wait before trying again.",
        429,
        { "Retry-After": String(permit.retryAfter) },
      );
    }
    try {
      const issued = await issueDemoCapability(request, action, {
        ttlSeconds: action === "twilio" ? 30 : 60,
      });
      if (!issued) {
        throw new ApiError(
          "capability_service_unavailable",
          "Provider capabilities are unavailable.",
          503,
        );
      }
      return jsonResponse(requestId, {
        capability: issued.token,
        action,
        expiresInSeconds: issued.expiresInSeconds,
      });
    } finally {
      await permit.release();
    }
  });
}
