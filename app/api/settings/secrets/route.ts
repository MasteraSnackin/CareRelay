import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  handleApiRoute,
  isLoopbackHostname,
  jsonResponse,
  readJsonWithLimit,
  requireSameOrigin,
} from "@/lib/api-response";
import {
  getProviderStatus,
  getProviderStatuses,
} from "@/lib/provider-status";
import {
  clearRuntimeSecrets,
  isRuntimeSecretEntryEnabled,
  safeProviderConfiguration,
  setRuntimeSecrets,
  type ProviderName,
} from "@/lib/runtime-secrets";

export const SETTINGS_BODY_LIMIT = 16_384;
const PROVIDERS = new Set<ProviderName>([
  "anthropic",
  "elevenlabs",
  "twilio",
]);

const VALUE_KEYS: Record<ProviderName, readonly string[]> = {
  anthropic: ["apiKey", "model"],
  elevenlabs: ["apiKey", "voiceId", "modelId"],
  twilio: [
    "accountSid",
    "authToken",
    "fromNumber",
    "allowedToNumber",
    "liveCallsEnabled",
  ],
};

function localMutationUrl(request: Request): URL {
  if (!isRuntimeSecretEntryEnabled()) {
    throw new ApiError(
      "runtime_secret_entry_disabled",
      "Temporary credential entry is disabled in this environment.",
      403,
    );
  }
  const url = requireSameOrigin(request);
  if (!isLoopbackHostname(url.hostname)) {
    throw new ApiError(
      "local_only",
      "Temporary credential entry is available only on a loopback host.",
      403,
    );
  }
  return url;
}

function providerFrom(value: unknown): ProviderName {
  if (typeof value !== "string" || !PROVIDERS.has(value as ProviderName)) {
    throw new ApiError(
      "unknown_provider",
      "Choose a supported provider.",
      400,
    );
  }
  return value as ProviderName;
}

export async function GET(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    const url = new URL(request.url);
    return jsonResponse(requestId, {
      temporaryEntry: {
        enabled:
          isRuntimeSecretEntryEnabled() &&
          isLoopbackHostname(url.hostname),
        storage: "server-process-memory",
        productionSecretManager: false,
      },
      providers: getProviderStatuses(),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    localMutationUrl(request);
    const body = await readJsonWithLimit<unknown>(
      request,
      SETTINGS_BODY_LIMIT,
    );
    assertPlainObject(body);
    assertOnlyKeys(body, ["provider", "values"]);
    const provider = providerFrom(body.provider);
    assertPlainObject(
      body.values,
      "invalid_values",
      "Credential values must be a JSON object.",
    );
    assertOnlyKeys(body.values, VALUE_KEYS[provider]);
    try {
      if (provider === "anthropic") {
        setRuntimeSecrets("anthropic", body.values);
      } else if (provider === "elevenlabs") {
        setRuntimeSecrets("elevenlabs", body.values);
      } else {
        setRuntimeSecrets("twilio", body.values);
      }
    } catch {
      throw new ApiError(
        "invalid_credentials",
        "At least one valid credential value is required.",
        400,
      );
    }
    return jsonResponse(requestId, {
      saved: true,
      configuration: safeProviderConfiguration(provider),
      provider: getProviderStatus(provider),
    });
  });
}

export const PUT = POST;

export async function DELETE(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) => {
    localMutationUrl(request);
    const body = await readJsonWithLimit<unknown>(
      request,
      SETTINGS_BODY_LIMIT,
    );
    assertPlainObject(body);
    assertOnlyKeys(body, ["provider"]);
    const provider = providerFrom(body.provider);
    clearRuntimeSecrets(provider);
    return jsonResponse(requestId, {
      cleared: true,
      configuration: safeProviderConfiguration(provider),
      provider: getProviderStatus(provider),
    });
  });
}
