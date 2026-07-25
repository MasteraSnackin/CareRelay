import { checkAnthropicReadiness } from "./anthropic";
import { checkElevenLabsReadiness } from "./elevenlabs";
import {
  configurationSource,
  isProviderConfigured,
  runtimeSecretGeneration,
  getTwilioConfig,
  type ConfigurationSource,
  type ProviderName,
} from "./runtime-secrets";
import { checkTwilioReadiness } from "./twilio";

export type ProviderState =
  | "not-configured"
  | "configured-not-tested"
  | "checking"
  | "connected"
  | "connection-failed";

export interface ProviderStatus {
  provider: ProviderName;
  label: string;
  role: string;
  privacy: string;
  configured: boolean;
  source: ConfigurationSource;
  state: ProviderState;
  liveCallsEnabled?: boolean;
}

interface ReadinessRecord {
  generation: number;
  state: Extract<ProviderState, "checking" | "connected" | "connection-failed">;
  checkedAt?: number;
}

interface ReadinessCheck {
  generation: number;
  promise: Promise<ProviderStatus>;
}

const STATUS_SYMBOL = Symbol.for("carerelay.provider-status");
const CHECK_SYMBOL = Symbol.for("carerelay.provider-status-checks");
export const READINESS_CACHE_MS = 10_000;

function readinessStore(): Partial<Record<ProviderName, ReadinessRecord>> {
  const target = globalThis as typeof globalThis & {
    [STATUS_SYMBOL]?: Partial<Record<ProviderName, ReadinessRecord>>;
  };
  target[STATUS_SYMBOL] ??= {};
  return target[STATUS_SYMBOL];
}

function readinessChecks(): Partial<Record<ProviderName, ReadinessCheck>> {
  const target = globalThis as typeof globalThis & {
    [CHECK_SYMBOL]?: Partial<Record<ProviderName, ReadinessCheck>>;
  };
  target[CHECK_SYMBOL] ??= {};
  return target[CHECK_SYMBOL];
}

const PROVIDER_COPY: Record<
  ProviderName,
  Pick<ProviderStatus, "label" | "role" | "privacy">
> = {
  anthropic: {
    label: "Anthropic Claude",
    role: "Optional grounded questions",
    privacy:
      "Only the selected synthetic fixture evidence and submitted question are sent when Claude is configured.",
  },
  elevenlabs: {
    label: "ElevenLabs",
    role: "Optional approved synthetic speech",
    privacy:
      "Only fixed, server-approved synthetic text can be sent for speech generation.",
  },
  twilio: {
    label: "Twilio",
    role: "Optional controlled test call",
    privacy:
      "Only a fixed destination, caller and one-way synthetic script can be sent when live calls are explicitly enabled.",
  },
};

export function getProviderStatus(provider: ProviderName): ProviderStatus {
  const configured = isProviderConfigured(provider);
  const source = configurationSource(provider);
  const readiness = readinessStore()[provider];
  let state: ProviderState = configured
    ? "configured-not-tested"
    : "not-configured";
  if (
    configured &&
    readiness &&
    readiness.generation === runtimeSecretGeneration()
  ) {
    state = readiness.state;
  }
  const status: ProviderStatus = {
    provider,
    ...PROVIDER_COPY[provider],
    configured,
    source,
    state,
  };
  if (provider === "twilio") {
    status.liveCallsEnabled = getTwilioConfig().liveCallsEnabled;
  }
  return status;
}

export function getProviderStatuses(): ProviderStatus[] {
  return (["anthropic", "elevenlabs", "twilio"] as const).map(
    getProviderStatus,
  );
}

export async function checkProviderReadiness(
  provider: ProviderName,
  now = Date.now(),
): Promise<ProviderStatus> {
  if (!isProviderConfigured(provider)) {
    delete readinessStore()[provider];
    return getProviderStatus(provider);
  }
  const generation = runtimeSecretGeneration();
  const current = readinessStore()[provider];
  if (
    current?.generation === generation &&
    current.checkedAt !== undefined &&
    now - current.checkedAt >= 0 &&
    now - current.checkedAt < READINESS_CACHE_MS
  ) {
    return getProviderStatus(provider);
  }
  const existing = readinessChecks()[provider];
  if (existing?.generation === generation) {
    return existing.promise;
  }
  readinessStore()[provider] = { generation, state: "checking" };

  const promise = (async () => {
    let connected = false;
    if (provider === "anthropic") {
      connected = await checkAnthropicReadiness();
    } else if (provider === "elevenlabs") {
      connected = await checkElevenLabsReadiness();
    } else {
      connected = await checkTwilioReadiness();
    }

    if (generation === runtimeSecretGeneration()) {
      readinessStore()[provider] = {
        generation,
        state: connected ? "connected" : "connection-failed",
        checkedAt: Date.now(),
      };
    }
    return getProviderStatus(provider);
  })();
  const check = { generation, promise };
  readinessChecks()[provider] = check;
  try {
    return await promise;
  } finally {
    if (readinessChecks()[provider] === check) {
      delete readinessChecks()[provider];
    }
  }
}

export function resetProviderReadiness(): void {
  for (const provider of [
    "anthropic",
    "elevenlabs",
    "twilio",
  ] as const) {
    delete readinessStore()[provider];
    delete readinessChecks()[provider];
  }
}
