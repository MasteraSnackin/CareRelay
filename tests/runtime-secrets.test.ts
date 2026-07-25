import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  DELETE as clearTemporaryCredentials,
  GET as getTemporaryCredentialStatus,
  POST as saveTemporaryCredentials,
} from "../app/api/settings/secrets/route";
import {
  clearAllRuntimeSecrets,
  clearRuntimeSecrets,
  configurationSource,
  getAnthropicConfig,
  getElevenLabsConfig,
  getTwilioConfig,
  isProviderConfigured,
  isRuntimeSecretEntryEnabled,
  isTwilioLiveCallReady,
  runtimeSecretGeneration,
  safeProviderConfiguration,
  setRuntimeSecrets,
} from "../lib/runtime-secrets";

const environmentNames = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ELEVENLABS_MODEL_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_ALLOWED_TO_NUMBER",
  "CARERELAY_LIVE_CALLS_ENABLED",
  "CARERELAY_RUNTIME_SECRET_ENTRY_ENABLED",
  "NODE_ENV",
] as const;

const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
) as Record<(typeof environmentNames)[number], string | undefined>;

function setNodeEnvironment(value: string | undefined): void {
  const environment = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete environment.NODE_ENV;
  } else {
    environment.NODE_ENV = value;
  }
}

function clearEnvironment() {
  for (const name of environmentNames) {
    delete process.env[name];
  }
}

function settingsRequest(
  url: string,
  {
    body,
    method = "GET",
    origin = new URL(url).origin,
    host = new URL(url).host,
  }: {
    body?: unknown;
    method?: string;
    origin?: string;
    host?: string;
  } = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host,
      origin,
      "x-request-id": "settings-route-test",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  clearAllRuntimeSecrets();
  clearEnvironment();
  setNodeEnvironment("test");
  process.env.CARERELAY_RUNTIME_SECRET_ENTRY_ENABLED = "true";
});

after(() => {
  clearAllRuntimeSecrets();
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      (process.env as Record<string, string | undefined>)[name] = value;
    }
  }
});

test("uses safe defaults when optional providers are absent", () => {
  assert.deepEqual(getAnthropicConfig(), {
    apiKey: "",
    model: "claude-sonnet-5",
  });
  assert.deepEqual(getElevenLabsConfig(), {
    apiKey: "",
    voiceId: "",
    modelId: "eleven_multilingual_v2",
  });
  assert.deepEqual(getTwilioConfig(), {
    accountSid: "",
    authToken: "",
    fromNumber: "",
    allowedToNumber: "",
    liveCallsEnabled: false,
  });
  for (const provider of ["anthropic", "elevenlabs", "twilio"] as const) {
    assert.equal(isProviderConfigured(provider), false);
    assert.equal(configurationSource(provider), "none");
  }
  assert.equal(isTwilioLiveCallReady(), false);
});

test("temporary runtime credential entry requires an explicit non-production flag", async () => {
  delete process.env.CARERELAY_RUNTIME_SECRET_ENTRY_ENABLED;
  assert.equal(isRuntimeSecretEntryEnabled(), false);
  let status = await getTemporaryCredentialStatus(
    settingsRequest("http://localhost:3000/api/settings/secrets"),
  );
  assert.equal((await status.json()).temporaryEntry.enabled, false);

  const disabled = await saveTemporaryCredentials(
    settingsRequest("http://localhost:3000/api/settings/secrets", {
      method: "POST",
      body: {
        provider: "anthropic",
        values: { apiKey: "must-not-be-saved" },
      },
    }),
  );
  assert.equal(disabled.status, 403);
  assert.equal(
    (await disabled.json()).error.code,
    "runtime_secret_entry_disabled",
  );

  process.env.CARERELAY_RUNTIME_SECRET_ENTRY_ENABLED = "true";
  setNodeEnvironment("production");
  assert.equal(isRuntimeSecretEntryEnabled(), false);
  status = await getTemporaryCredentialStatus(
    settingsRequest("http://localhost:3000/api/settings/secrets"),
  );
  assert.equal((await status.json()).temporaryEntry.enabled, false);
});

test("runtime values override environment and clearing reveals the environment unchanged", () => {
  process.env.ANTHROPIC_API_KEY = "environment-anthropic-secret";
  process.env.ANTHROPIC_MODEL = "environment-model";
  process.env.ELEVENLABS_API_KEY = "environment-eleven-secret";
  process.env.ELEVENLABS_VOICE_ID = "environment-voice";

  setRuntimeSecrets("anthropic", {
    apiKey: "runtime-anthropic-secret",
    model: "runtime-model",
  });
  setRuntimeSecrets("elevenlabs", {
    apiKey: "runtime-eleven-secret",
    voiceId: "runtime-voice",
    modelId: "runtime-model-id",
  });

  assert.deepEqual(getAnthropicConfig(), {
    apiKey: "runtime-anthropic-secret",
    model: "runtime-model",
  });
  assert.equal(configurationSource("anthropic"), "mixed");
  assert.deepEqual(getElevenLabsConfig(), {
    apiKey: "runtime-eleven-secret",
    voiceId: "runtime-voice",
    modelId: "runtime-model-id",
  });

  clearRuntimeSecrets("anthropic");
  clearRuntimeSecrets("elevenlabs");
  assert.deepEqual(getAnthropicConfig(), {
    apiKey: "environment-anthropic-secret",
    model: "environment-model",
  });
  assert.deepEqual(getElevenLabsConfig(), {
    apiKey: "environment-eleven-secret",
    voiceId: "environment-voice",
    modelId: "eleven_multilingual_v2",
  });
  assert.equal(configurationSource("anthropic"), "environment");
});

test("safe configuration summaries do not disclose values, suffixes or lengths", () => {
  const secrets = [
    "anthropic-super-secret-UNIQUE",
    "eleven-super-secret-UNIQUE",
    "voice-secret-UNIQUE",
    "AC11111111111111111111111111111111",
    "twilio-auth-secret-UNIQUE",
    "+442079460999",
    "+442079460998",
  ];
  setRuntimeSecrets("anthropic", { apiKey: secrets[0]!, model: "private-model" });
  setRuntimeSecrets("elevenlabs", {
    apiKey: secrets[1]!,
    voiceId: secrets[2]!,
  });
  setRuntimeSecrets("twilio", {
    accountSid: secrets[3]!,
    authToken: secrets[4]!,
    fromNumber: secrets[5]!,
    allowedToNumber: secrets[6]!,
    liveCallsEnabled: true,
  });

  const serialised = JSON.stringify(
    (["anthropic", "elevenlabs", "twilio"] as const).map((provider) =>
      safeProviderConfiguration(provider),
    ),
  );
  for (const secret of secrets) {
    assert.equal(serialised.includes(secret), false);
    assert.equal(serialised.includes(secret.slice(-6)), false);
    assert.equal(serialised.includes(String(secret.length)), false);
  }
  assert.deepEqual(safeProviderConfiguration("anthropic"), {
    provider: "anthropic",
    configured: true,
    source: "runtime",
  });
  assert.deepEqual(safeProviderConfiguration("twilio"), {
    provider: "twilio",
    configured: true,
    source: "runtime",
    liveCallsEnabled: true,
  });
});

test("Twilio readiness requires fixed configuration and explicit enablement", () => {
  setRuntimeSecrets("twilio", {
    accountSid: "AC11111111111111111111111111111111",
    authToken: "auth-secret",
    fromNumber: "+442079460999",
    allowedToNumber: "+442079460998",
    liveCallsEnabled: false,
  });
  assert.equal(isProviderConfigured("twilio"), true);
  assert.equal(isTwilioLiveCallReady(), false);

  setRuntimeSecrets("twilio", {
    accountSid: "AC11111111111111111111111111111111",
    authToken: "auth-secret",
    fromNumber: "+442079460999",
    allowedToNumber: "+442079460998",
    liveCallsEnabled: true,
  });
  assert.equal(isTwilioLiveCallReady(), true);
});

test("mutations are generation-tracked and reject empty values", () => {
  const startingGeneration = runtimeSecretGeneration();
  setRuntimeSecrets("anthropic", { apiKey: " runtime-key " });
  assert.equal(runtimeSecretGeneration(), startingGeneration + 1);
  assert.equal(getAnthropicConfig().apiKey, "runtime-key");

  clearRuntimeSecrets("anthropic");
  assert.equal(runtimeSecretGeneration(), startingGeneration + 2);
  assert.throws(
    () => setRuntimeSecrets("anthropic", { apiKey: "  " }),
    /No valid runtime credential values/,
  );
});

test("temporary credential mutation is loopback-only and exact same-origin", async () => {
  const publicResponse = await saveTemporaryCredentials(
    settingsRequest("https://care-relay.test/api/settings/secrets", {
      method: "POST",
      body: {
        provider: "anthropic",
        values: { apiKey: "must-not-be-saved" },
      },
    }),
  );
  assert.equal(publicResponse.status, 403);
  assert.equal((await publicResponse.json()).error.code, "local_only");
  assert.equal(getAnthropicConfig().apiKey, "");

  const crossOrigin = await saveTemporaryCredentials(
    settingsRequest("http://localhost:3000/api/settings/secrets", {
      method: "POST",
      origin: "http://attacker.test",
      body: {
        provider: "anthropic",
        values: { apiKey: "must-not-be-saved" },
      },
    }),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "cross_origin_request");

  const conflictingHost = await saveTemporaryCredentials(
    settingsRequest("http://localhost:3000/api/settings/secrets", {
      method: "POST",
      host: "127.0.0.1:3000",
      body: {
        provider: "anthropic",
        values: { apiKey: "must-not-be-saved" },
      },
    }),
  );
  assert.equal(conflictingHost.status, 403);
  assert.equal(
    (await conflictingHost.json()).error.code,
    "conflicting_host_headers",
  );
  assert.equal(getAnthropicConfig().apiKey, "");
});

test("loopback settings save and clear credentials without returning secret material", async () => {
  process.env.ANTHROPIC_API_KEY = "environment-key-after-clear";
  const runtimeSecret = "runtime-key-UNIQUE-DO-NOT-RETURN";
  const save = await saveTemporaryCredentials(
    settingsRequest("http://127.0.0.1:3000/api/settings/secrets", {
      method: "POST",
      body: {
        provider: "anthropic",
        values: {
          apiKey: runtimeSecret,
          model: "runtime-test-model",
        },
      },
    }),
  );
  const saveText = await save.text();
  assert.equal(save.status, 200, saveText);
  assert.equal(save.headers.get("cache-control"), "no-store");
  assert.equal(save.headers.get("x-request-id"), "settings-route-test");
  assert.doesNotMatch(saveText, new RegExp(runtimeSecret));
  assert.doesNotMatch(saveText, new RegExp(runtimeSecret.slice(-8)));
  assert.doesNotMatch(saveText, /environment-key-after-clear/);
  assert.equal(getAnthropicConfig().apiKey, runtimeSecret);
  assert.deepEqual(JSON.parse(saveText).configuration, {
    provider: "anthropic",
    configured: true,
    source: "mixed",
  });

  const clear = await clearTemporaryCredentials(
    settingsRequest("http://127.0.0.1:3000/api/settings/secrets", {
      method: "DELETE",
      body: { provider: "anthropic" },
    }),
  );
  const clearText = await clear.text();
  assert.equal(clear.status, 200, clearText);
  assert.doesNotMatch(clearText, /environment-key-after-clear/);
  assert.equal(getAnthropicConfig().apiKey, "environment-key-after-clear");
  assert.equal(JSON.parse(clearText).configuration.source, "environment");
});

test("settings status enables temporary entry only on exact loopback hosts", async () => {
  for (const [url, enabled] of [
    ["http://localhost:3000/api/settings/secrets", true],
    ["http://127.0.0.1:3000/api/settings/secrets", true],
    ["http://[::1]:3000/api/settings/secrets", true],
    ["https://care-relay.test/api/settings/secrets", false],
    ["https://localhost.example/api/settings/secrets", false],
  ] as const) {
    const response = await getTemporaryCredentialStatus(
      settingsRequest(url),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.temporaryEntry, {
      enabled,
      storage: "server-process-memory",
      productionSecretManager: false,
    });
    assert.doesNotMatch(JSON.stringify(body), /apiKey|authToken|fromNumber/);
  }
});
