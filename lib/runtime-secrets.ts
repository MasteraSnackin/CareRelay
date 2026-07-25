import { isProductionRuntime } from "./demo-capability";

export type ProviderName = "anthropic" | "elevenlabs" | "twilio";
export type ConfigurationSource = "none" | "environment" | "runtime" | "mixed";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  allowedToNumber: string;
  liveCallsEnabled: boolean;
}

export interface RuntimeSecretValues {
  anthropic: Partial<AnthropicConfig>;
  elevenlabs: Partial<ElevenLabsConfig>;
  twilio: Partial<TwilioConfig>;
}

interface RuntimeSecretStore {
  generation: number;
  values: RuntimeSecretValues;
}

const STORE_SYMBOL = Symbol.for("carerelay.runtime-secrets");

function createStore(): RuntimeSecretStore {
  return {
    generation: 0,
    values: {
      anthropic: {},
      elevenlabs: {},
      twilio: {},
    },
  };
}

function store(): RuntimeSecretStore {
  const target = globalThis as typeof globalThis & {
    [STORE_SYMBOL]?: RuntimeSecretStore;
  };
  target[STORE_SYMBOL] ??= createStore();
  return target[STORE_SYMBOL];
}

function environmentValue(name: string): string {
  if (typeof process === "undefined") {
    return "";
  }
  return process.env[name]?.trim() ?? "";
}

export function isRuntimeSecretEntryEnabled(): boolean {
  return (
    !isProductionRuntime() &&
    environmentValue("CARERELAY_RUNTIME_SECRET_ENTRY_ENABLED").toLowerCase() ===
      "true"
  );
}

function runtimeString(
  provider: ProviderName,
  key: string,
): string | undefined {
  const values = store().values[provider] as Record<string, unknown>;
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

function resolvedString(
  provider: ProviderName,
  key: string,
  environmentName: string,
  fallback = "",
): string {
  return (
    runtimeString(provider, key) ??
    environmentValue(environmentName) ??
    fallback
  );
}

export function getAnthropicConfig(): AnthropicConfig {
  return {
    apiKey: resolvedString("anthropic", "apiKey", "ANTHROPIC_API_KEY"),
    model:
      resolvedString(
        "anthropic",
        "model",
        "ANTHROPIC_MODEL",
        "claude-sonnet-5",
      ) || "claude-sonnet-5",
  };
}

export function getElevenLabsConfig(): ElevenLabsConfig {
  return {
    apiKey: resolvedString("elevenlabs", "apiKey", "ELEVENLABS_API_KEY"),
    voiceId: resolvedString(
      "elevenlabs",
      "voiceId",
      "ELEVENLABS_VOICE_ID",
    ),
    modelId:
      resolvedString(
        "elevenlabs",
        "modelId",
        "ELEVENLABS_MODEL_ID",
        "eleven_multilingual_v2",
      ) || "eleven_multilingual_v2",
  };
}

export function getTwilioConfig(): TwilioConfig {
  const runtimeFlag = store().values.twilio.liveCallsEnabled;
  return {
    accountSid: resolvedString(
      "twilio",
      "accountSid",
      "TWILIO_ACCOUNT_SID",
    ),
    authToken: resolvedString(
      "twilio",
      "authToken",
      "TWILIO_AUTH_TOKEN",
    ),
    fromNumber: resolvedString(
      "twilio",
      "fromNumber",
      "TWILIO_PHONE_NUMBER",
    ),
    allowedToNumber: resolvedString(
      "twilio",
      "allowedToNumber",
      "TWILIO_ALLOWED_TO_NUMBER",
    ),
    liveCallsEnabled:
      typeof runtimeFlag === "boolean"
        ? runtimeFlag
        : environmentValue("CARERELAY_LIVE_CALLS_ENABLED").toLowerCase() ===
          "true",
  };
}

function hasRuntimeValues(provider: ProviderName): boolean {
  return Object.keys(store().values[provider]).length > 0;
}

function hasEnvironmentValues(provider: ProviderName): boolean {
  if (provider === "anthropic") {
    return environmentValue("ANTHROPIC_API_KEY") !== "";
  }
  if (provider === "elevenlabs") {
    return (
      environmentValue("ELEVENLABS_API_KEY") !== "" ||
      environmentValue("ELEVENLABS_VOICE_ID") !== ""
    );
  }
  return [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "TWILIO_ALLOWED_TO_NUMBER",
    "CARERELAY_LIVE_CALLS_ENABLED",
  ].some((name) => environmentValue(name) !== "");
}

export function configurationSource(provider: ProviderName): ConfigurationSource {
  const runtime = hasRuntimeValues(provider);
  const environment = hasEnvironmentValues(provider);
  if (runtime && environment) {
    return "mixed";
  }
  if (runtime) {
    return "runtime";
  }
  if (environment) {
    return "environment";
  }
  return "none";
}

export function isProviderConfigured(provider: ProviderName): boolean {
  if (provider === "anthropic") {
    return getAnthropicConfig().apiKey.length > 0;
  }
  if (provider === "elevenlabs") {
    const config = getElevenLabsConfig();
    return config.apiKey.length > 0 && config.voiceId.length > 0;
  }
  const config = getTwilioConfig();
  return (
    config.accountSid.length > 0 &&
    config.authToken.length > 0 &&
    config.fromNumber.length > 0 &&
    config.allowedToNumber.length > 0
  );
}

export function isTwilioLiveCallReady(): boolean {
  return isProviderConfigured("twilio") && getTwilioConfig().liveCallsEnabled;
}

function cleanString(value: unknown, maximum = 512): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const clean = value.trim();
  return clean.length > 0 && clean.length <= maximum ? clean : undefined;
}

export function setRuntimeSecrets(
  provider: "anthropic",
  values: Partial<AnthropicConfig>,
): void;
export function setRuntimeSecrets(
  provider: "elevenlabs",
  values: Partial<ElevenLabsConfig>,
): void;
export function setRuntimeSecrets(
  provider: "twilio",
  values: Partial<TwilioConfig>,
): void;
export function setRuntimeSecrets(
  provider: ProviderName,
  values: Record<string, unknown>,
): void {
  const next: Record<string, string | boolean> = {};
  if (provider === "anthropic") {
    const apiKey = cleanString(values.apiKey);
    const model = cleanString(values.model, 128);
    if (apiKey) next.apiKey = apiKey;
    if (model) next.model = model;
  } else if (provider === "elevenlabs") {
    const apiKey = cleanString(values.apiKey);
    const voiceId = cleanString(values.voiceId, 128);
    const modelId = cleanString(values.modelId, 128);
    if (apiKey) next.apiKey = apiKey;
    if (voiceId) next.voiceId = voiceId;
    if (modelId) next.modelId = modelId;
  } else {
    const accountSid = cleanString(values.accountSid, 128);
    const authToken = cleanString(values.authToken);
    const fromNumber = cleanString(values.fromNumber, 64);
    const allowedToNumber = cleanString(values.allowedToNumber, 64);
    if (accountSid) next.accountSid = accountSid;
    if (authToken) next.authToken = authToken;
    if (fromNumber) next.fromNumber = fromNumber;
    if (allowedToNumber) next.allowedToNumber = allowedToNumber;
    if (typeof values.liveCallsEnabled === "boolean") {
      next.liveCallsEnabled = values.liveCallsEnabled;
    }
  }

  if (Object.keys(next).length === 0) {
    throw new Error("No valid runtime credential values were supplied.");
  }
  store().values[provider] = next as never;
  store().generation += 1;
}

export function clearRuntimeSecrets(provider: ProviderName): void {
  store().values[provider] = {} as never;
  store().generation += 1;
}

export function clearAllRuntimeSecrets(): void {
  store().values = {
    anthropic: {},
    elevenlabs: {},
    twilio: {},
  };
  store().generation += 1;
}

export function runtimeSecretGeneration(): number {
  return store().generation;
}

export interface SafeProviderConfiguration {
  provider: ProviderName;
  configured: boolean;
  source: ConfigurationSource;
  liveCallsEnabled?: boolean;
}

export function safeProviderConfiguration(
  provider: ProviderName,
): SafeProviderConfiguration {
  const summary: SafeProviderConfiguration = {
    provider,
    configured: isProviderConfigured(provider),
    source: configurationSource(provider),
  };
  if (provider === "twilio") {
    summary.liveCallsEnabled = getTwilioConfig().liveCallsEnabled;
  }
  return summary;
}
