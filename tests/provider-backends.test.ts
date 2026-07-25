import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { POST as callPost } from "../app/api/calls/mock/route";
import { POST as capabilityPost } from "../app/api/providers/capability/route";
import { POST as voicePost } from "../app/api/voice/route";
import {
  issueDemoCapability,
  resetDemoCapabilityState,
  verifyAndConsumeDemoCapability,
  type DemoCapabilityAction,
} from "../lib/demo-capability";
import {
  APPROVED_SPEECH,
  MAX_ELEVENLABS_AUDIO_BYTES,
  checkElevenLabsReadiness,
  isApprovedSpeechId,
  resolveApprovedSpeech,
  synthesiseApprovedSpeech,
} from "../lib/elevenlabs";
import {
  acquireCoordinatedMeteredPermit,
  acquireMeteredPermit,
  configureProviderAbuseCoordinator,
  resetProviderAbuseControl,
} from "../lib/provider-abuse-control";
import {
  checkProviderReadiness,
  resetProviderReadiness,
} from "../lib/provider-status";
import {
  clearAllRuntimeSecrets,
  setRuntimeSecrets,
} from "../lib/runtime-secrets";
import {
  TWILIO_FIXED_TWIML,
  checkTwilioReadiness,
  queueControlledTwilioCall,
} from "../lib/twilio";
import {
  TWILIO_COOLDOWN_MS,
  acquireCoordinatedTwilioCallPermit,
  acquireTwilioCallPermit,
  configureTwilioCallCoordinator,
  getTwilioCallGuardState,
  resetTwilioCallGuard,
} from "../lib/twilio-call-guard";

const originalFetch = globalThis.fetch;
const originalNodeEnvironment = process.env.NODE_ENV;
const originalCapabilitySecret =
  process.env.CARERELAY_DEMO_CAPABILITY_SECRET;

function setNodeEnvironment(value: string | undefined): void {
  const environment = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete environment.NODE_ENV;
  } else {
    environment.NODE_ENV = value;
  }
}

beforeEach(() => {
  clearAllRuntimeSecrets();
  resetTwilioCallGuard();
  resetProviderAbuseControl();
  resetProviderReadiness();
  resetDemoCapabilityState();
  setNodeEnvironment("test");
  delete process.env.CARERELAY_DEMO_CAPABILITY_SECRET;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAllRuntimeSecrets();
  resetTwilioCallGuard();
  resetProviderAbuseControl();
  resetProviderReadiness();
  resetDemoCapabilityState();
  globalThis.fetch = originalFetch;
  setNodeEnvironment(originalNodeEnvironment);
  if (originalCapabilitySecret === undefined) {
    delete process.env.CARERELAY_DEMO_CAPABILITY_SECRET;
  } else {
    process.env.CARERELAY_DEMO_CAPABILITY_SECRET =
      originalCapabilitySecret;
  }
});

function configureElevenLabs() {
  setRuntimeSecrets("elevenlabs", {
    apiKey: "test-elevenlabs-key",
    voiceId: "test-voice-id",
    modelId: "test-model-id",
  });
}

function configureTwilio() {
  setRuntimeSecrets("twilio", {
    accountSid: "AC11111111111111111111111111111111",
    authToken: "test-twilio-token",
    fromNumber: "+442079460099",
    allowedToNumber: "+442079460098",
    liveCallsEnabled: true,
  });
}

function controlledCallRequest(
  body: string,
  {
    origin = "https://care-relay.test",
    contentType = "application/json",
    capability,
  }: {
    origin?: string;
    contentType?: string;
    capability?: string;
  } = {},
): Request {
  return new Request("https://care-relay.test/api/calls/mock", {
    method: "POST",
    headers: {
      host: "care-relay.test",
      origin,
      "content-type": contentType,
      "x-request-id": "provider-backend-test",
      ...(capability
        ? { "x-carerelay-capability": capability }
        : {}),
    },
    body,
  });
}

async function tokenFor(
  request: Request,
  action: DemoCapabilityAction,
  options: { now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const issued = await issueDemoCapability(request, action, options);
  assert.ok(issued, `${action} capability should be issued`);
  return issued.token;
}

async function authorisedCallRequest(
  body = '{"consent":true}',
): Promise<Request> {
  const basis = controlledCallRequest(body);
  return controlledCallRequest(body, {
    capability: await tokenFor(basis, "twilio"),
  });
}

function capabilityRequest(
  body: unknown,
  origin = "https://care-relay.test",
): Request {
  return new Request("https://care-relay.test/api/providers/capability", {
    method: "POST",
    headers: {
      host: "care-relay.test",
      origin,
      "content-type": "application/json",
      "x-request-id": "capability-route-test",
    },
    body: JSON.stringify(body),
  });
}

function voiceRequest(
  body: unknown,
  capability?: string,
): Request {
  return new Request("https://care-relay.test/api/voice", {
    method: "POST",
    headers: {
      host: "care-relay.test",
      origin: "https://care-relay.test",
      "content-type": "application/json",
      "x-request-id": "voice-route-test",
      ...(capability
        ? { "x-carerelay-capability": capability }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

test("capabilities are short-lived, action-bound, client-bound and one-use", async () => {
  const request = voiceRequest({
    fixtureId: "rheumatology",
    speechId: "rheumatology-plain",
  });
  const wrongActionToken = await tokenFor(request, "anthropic");
  assert.deepEqual(
    await verifyAndConsumeDemoCapability(
      request,
      "elevenlabs",
      wrongActionToken,
    ),
    { ok: false, reason: "expired-or-mismatched" },
  );

  const token = await tokenFor(request, "elevenlabs");
  const first = await verifyAndConsumeDemoCapability(
    request,
    "elevenlabs",
    token,
  );
  assert.equal(first.ok, true);
  assert.deepEqual(
    await verifyAndConsumeDemoCapability(request, "elevenlabs", token),
    { ok: false, reason: "replayed" },
  );

  const clientToken = await tokenFor(request, "elevenlabs");
  const otherClient = new Request(request.url, {
    headers: {
      "user-agent": "different-controlled-client",
    },
  });
  assert.deepEqual(
    await verifyAndConsumeDemoCapability(
      otherClient,
      "elevenlabs",
      clientToken,
    ),
    { ok: false, reason: "expired-or-mismatched" },
  );

  const now = 100_000;
  const expiredToken = await tokenFor(request, "elevenlabs", {
    now,
    ttlSeconds: 10,
  });
  assert.deepEqual(
    await verifyAndConsumeDemoCapability(
      request,
      "elevenlabs",
      expiredToken,
      now + 10_000,
    ),
    { ok: false, reason: "expired-or-mismatched" },
  );
});

test("the capability endpoint is exact same-origin and requires call consent", async () => {
  const issued = await capabilityPost(
    capabilityRequest({ action: "elevenlabs" }),
  );
  assert.equal(issued.status, 200);
  const body = (await issued.json()) as {
    capability: string;
    action: string;
    expiresInSeconds: number;
  };
  assert.equal(body.action, "elevenlabs");
  assert.equal(body.expiresInSeconds, 60);
  assert.match(body.capability, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const callWithoutConsent = await capabilityPost(
    capabilityRequest({ action: "twilio" }),
  );
  assert.equal(callWithoutConsent.status, 400);
  assert.equal(
    (await callWithoutConsent.json()).error.code,
    "invalid_capability_consent",
  );

  const crossOrigin = await capabilityPost(
    capabilityRequest(
      { action: "anthropic" },
      "https://attacker.test",
    ),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "cross_origin_request",
  );
});

test("paid capability issuance fails closed in production without distributed coordination", async () => {
  setNodeEnvironment("production");
  process.env.CARERELAY_DEMO_CAPABILITY_SECRET = "s".repeat(32);
  resetProviderAbuseControl();

  const unavailable = await capabilityPost(
    capabilityRequest({ action: "anthropic" }),
  );
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await unavailable.json()).error.code,
    "capability_coordination_unavailable",
  );

  let released = false;
  configureProviderAbuseCoordinator({
    async acquire(action, clientBinding) {
      assert.equal(action, "capability");
      assert.match(clientBinding, /^[A-Za-z0-9_-]{32}$/);
      return {
        ok: true,
        async release() {
          released = true;
        },
      };
    },
  });
  const coordinated = await capabilityPost(
    capabilityRequest({ action: "anthropic" }),
  );
  assert.equal(coordinated.status, 200);
  assert.equal((await coordinated.json()).expiresInSeconds, 60);
  assert.equal(released, true);
});

test("local provider meters enforce per-client, global and concurrency bounds", async () => {
  const first = acquireMeteredPermit("anthropic", "client-a", 1_000);
  const second = acquireMeteredPermit("anthropic", "client-a", 1_000);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(
    acquireMeteredPermit("anthropic", "client-a", 1_000),
    { ok: false, reason: "concurrency", retryAfter: 1 },
  );
  if (!first.ok || !second.ok) assert.fail("permits should be available");
  first.release();
  second.release();

  for (let index = 0; index < 6; index += 1) {
    const permit = acquireMeteredPermit(
      "anthropic",
      "client-a",
      1_000,
    );
    assert.equal(permit.ok, true);
    if (permit.ok) permit.release();
  }
  const clientLimited = acquireMeteredPermit(
    "anthropic",
    "client-a",
    1_000,
  );
  assert.equal(clientLimited.ok, false);
  if (!clientLimited.ok) {
    assert.equal(clientLimited.reason, "client-quota");
    assert.equal(clientLimited.retryAfter, 60);
  }

  resetProviderAbuseControl();
  for (let index = 0; index < 30; index += 1) {
    const permit = acquireMeteredPermit(
      "anthropic",
      `client-${index}`,
      2_000,
    );
    assert.equal(permit.ok, true);
    if (permit.ok) permit.release();
  }
  const globalLimited = acquireMeteredPermit(
    "anthropic",
    "client-over-global",
    2_000,
  );
  assert.equal(globalLimited.ok, false);
  if (!globalLimited.ok) {
    assert.equal(globalLimited.reason, "global-quota");
    assert.equal(globalLimited.retryAfter, 60);
  }
});

test("coordinated provider metering fails closed only in production", async () => {
  setNodeEnvironment("production");
  resetProviderAbuseControl();
  assert.deepEqual(
    await acquireCoordinatedMeteredPermit(
      "elevenlabs",
      "client-binding",
      1_000,
    ),
    {
      ok: false,
      reason: "coordination-unavailable",
      retryAfter: 60,
    },
  );
});

test("coordinator exceptions become a stable fail-closed result", async () => {
  configureProviderAbuseCoordinator({
    async acquire() {
      throw new Error("distributed provider coordinator unavailable");
    },
  });
  assert.deepEqual(
    await acquireCoordinatedMeteredPermit(
      "elevenlabs",
      "client-binding",
      1_000,
    ),
    {
      ok: false,
      reason: "coordination-unavailable",
      retryAfter: 60,
    },
  );

  configureTwilioCallCoordinator({
    async acquire() {
      throw new Error("distributed call coordinator unavailable");
    },
  });
  assert.deepEqual(await acquireCoordinatedTwilioCallPermit(1_000), {
    ok: false,
    retryAfter: 60,
    reason: "coordination-unavailable",
  });

  configureProviderAbuseCoordinator({
    async acquire() {
      return new Promise<never>(() => undefined);
    },
  });
  assert.deepEqual(
    await acquireCoordinatedMeteredPermit(
      "elevenlabs",
      "client-binding",
      1_000,
      20,
    ),
    {
      ok: false,
      reason: "coordination-unavailable",
      retryAfter: 60,
    },
  );

  configureTwilioCallCoordinator({
    async acquire() {
      return new Promise<never>(() => undefined);
    },
  });
  assert.deepEqual(
    await acquireCoordinatedTwilioCallPermit(1_000, 20),
    {
      ok: false,
      retryAfter: 60,
      reason: "coordination-unavailable",
    },
  );
});

test("allows only server-defined speech IDs for their matching fixture", () => {
  assert.equal(isApprovedSpeechId("rheumatology-plain"), true);
  assert.equal(isApprovedSpeechId("arbitrary-client-text"), false);
  assert.equal(
    resolveApprovedSpeech("rheumatology", "rheumatology-plain"),
    APPROVED_SPEECH["rheumatology-plain"],
  );
  assert.equal(
    resolveApprovedSpeech("diabetes", "rheumatology-plain"),
    undefined,
  );
  assert.equal(
    resolveApprovedSpeech("rheumatology", "__proto__"),
    undefined,
  );
});

test("ElevenLabs receives only approved text and returns bounded audio", async () => {
  configureElevenLabs();
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const audio = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(audio.byteLength),
      },
    });
  };

  const result = await synthesiseApprovedSpeech(
    "rheumatology",
    "rheumatology-plain",
    fakeFetch,
  );
  assert.deepEqual(result.bytes, audio);
  assert.equal(result.contentType, "audio/mpeg");
  assert.equal(result.language, "en-GB");
  assert.match(capturedUrl, /\/text-to-speech\/test-voice-id$/);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    new Headers(capturedInit?.headers).get("xi-api-key"),
    "test-elevenlabs-key",
  );
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    text: APPROVED_SPEECH["rheumatology-plain"].text,
    model_id: "test-model-id",
  });
});

test("ElevenLabs rejects mismatched media, excessive media and arbitrary IDs", async () => {
  configureElevenLabs();
  await assert.rejects(
    synthesiseApprovedSpeech("rheumatology", "arbitrary", async () => {
      throw new Error("must not call provider");
    }),
    /not approved/,
  );
  await assert.rejects(
    synthesiseApprovedSpeech(
      "rheumatology",
      "rheumatology-plain",
      async () =>
        new Response("provider error", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
    /approved audio/,
  );
  await assert.rejects(
    synthesiseApprovedSpeech(
      "rheumatology",
      "rheumatology-plain",
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "content-length": String(MAX_ELEVENLABS_AUDIO_BYTES + 1),
          },
        }),
    ),
    /exceeds the permitted size/,
  );
});

test("provider deadlines interrupt stalled response bodies and parent cancellation", async () => {
  configureElevenLabs();
  let speechCancelled = false;
  const stalledSpeech = new ReadableStream<Uint8Array>({
    cancel() {
      speechCancelled = true;
    },
  });
  await assert.rejects(
    synthesiseApprovedSpeech(
      "rheumatology",
      "rheumatology-plain",
      async () =>
        new Response(stalledSpeech, {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
      { timeoutMs: 20 },
    ),
    /provider request was interrupted/i,
  );
  assert.equal(speechCancelled, true);

  configureTwilio();
  let callCancelled = false;
  const stalledCall = new ReadableStream<Uint8Array>({
    cancel() {
      callCancelled = true;
    },
  });
  const controller = new AbortController();
  const pending = queueControlledTwilioCall(
    async () =>
      new Response(stalledCall, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    { signal: controller.signal, timeoutMs: 1_000 },
  );
  controller.abort();
  await assert.rejects(pending, /provider request was interrupted/i);
  assert.equal(callCancelled, true);
});

test("simultaneous readiness checks share one upstream request", async () => {
  configureElevenLabs();
  let providerRequests = 0;
  let releaseProvider!: () => void;
  globalThis.fetch = async () => {
    providerRequests += 1;
    await new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    return new Response(null, { status: 204 });
  };

  const first = checkProviderReadiness("elevenlabs");
  const second = checkProviderReadiness("elevenlabs");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(providerRequests, 1);
  releaseProvider();
  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.equal(firstStatus.state, "connected");
  assert.equal(secondStatus.state, "connected");
  assert.equal(
    (await checkProviderReadiness("elevenlabs")).state,
    "connected",
  );
  assert.equal(providerRequests, 1);
});

test("ElevenLabs readiness is read-only and never synthesises", async () => {
  configureElevenLabs();
  let request: { url: string; method: string } | undefined;
  const ready = await checkElevenLabsReadiness(async (input, init) => {
    request = {
      url: String(input),
      method: init?.method ?? "GET",
    };
    return new Response(null, { status: 204 });
  });
  assert.equal(ready, true);
  assert.deepEqual(request, {
    url: "https://api.elevenlabs.io/v1/user",
    method: "GET",
  });

  assert.equal(
    await checkElevenLabsReadiness(
      async () => new Promise<Response>(() => undefined),
      { timeoutMs: 20 },
    ),
    false,
  );
});

test("the voice route sends only approved IDs after a fresh capability", async () => {
  configureElevenLabs();
  const approvedBody = {
    fixtureId: "rheumatology",
    speechId: "rheumatology-plain",
  };

  const missingCapability = await voicePost(voiceRequest(approvedBody));
  assert.equal(missingCapability.status, 403);
  assert.equal(
    (await missingCapability.json()).error.code,
    "provider_capability_required",
  );

  const arbitraryText = await voicePost(
    voiceRequest({
      ...approvedBody,
      text: "Speak arbitrary visible content through the paid provider.",
    }),
  );
  assert.equal(arbitraryText.status, 400);
  assert.equal(
    (await arbitraryText.json()).error.code,
    "unexpected_field",
  );

  const basis = voiceRequest(approvedBody);
  const capability = await tokenFor(basis, "elevenlabs");
  let providerUsed = false;
  globalThis.fetch = async () => {
    providerUsed = true;
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "4",
      },
    });
  };
  const response = await voicePost(
    voiceRequest(approvedBody, capability),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(providerUsed, true);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([0x49, 0x44, 0x33, 1]),
  );
});

test("Twilio receives only the fixed destination, caller and one-way TwiML", async () => {
  configureTwilio();
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const queued = await queueControlledTwilioCall(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({
      sid: `CA${"a".repeat(32)}`,
      status: "queued",
    });
  });

  assert.deepEqual(queued, {
    sid: `CA${"a".repeat(32)}`,
    status: "queued",
  });
  assert.match(
    capturedUrl,
    /\/Accounts\/AC11111111111111111111111111111111\/Calls\.json$/,
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    new Headers(capturedInit?.headers).get("content-type"),
    "application/x-www-form-urlencoded",
  );
  const form = new URLSearchParams(String(capturedInit?.body));
  assert.deepEqual([...form.keys()].sort(), ["From", "To", "Twiml"]);
  assert.equal(form.get("To"), "+442079460098");
  assert.equal(form.get("From"), "+442079460099");
  assert.equal(form.get("Twiml"), TWILIO_FIXED_TWIML);
  assert.match(TWILIO_FIXED_TWIML, /<Say language="en-GB">/);
  assert.match(TWILIO_FIXED_TWIML, /<Hangup\/>/);
  assert.doesNotMatch(TWILIO_FIXED_TWIML, /<Record|<Gather|statusCallback/i);
});

test("Twilio readiness inspects the account without creating a call", async () => {
  configureTwilio();
  let request: { url: string; method: string } | undefined;
  const ready = await checkTwilioReadiness(async (input, init) => {
    request = {
      url: String(input),
      method: init?.method ?? "GET",
    };
    return new Response(null, { status: 200 });
  });
  assert.equal(ready, true);
  assert.deepEqual(request, {
    url: "https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111.json",
    method: "GET",
  });

  assert.equal(
    await checkTwilioReadiness(
      async () => new Promise<Response>(() => undefined),
      { timeoutMs: 20 },
    ),
    false,
  );
});

test("the Twilio permit enforces one in-flight request and a 60-second cooldown", () => {
  assert.equal(TWILIO_COOLDOWN_MS, 60_000);
  const first = acquireTwilioCallPermit(1_000);
  assert.equal(first.ok, true);
  const inFlight = acquireTwilioCallPermit(1_001);
  assert.deepEqual(inFlight, {
    ok: false,
    retryAfter: 1,
    reason: "in-flight",
  });

  if (!first.ok) assert.fail("first permit must be available");
  first.release();
  const retry = acquireTwilioCallPermit(2_000);
  assert.equal(retry.ok, true);
  if (!retry.ok) assert.fail("released permit must be reusable");
  retry.queued(2_000);
  assert.deepEqual(getTwilioCallGuardState(2_100), {
    inFlight: false,
    cooldownRemainingMs: 59_900,
  });
  assert.deepEqual(acquireTwilioCallPermit(2_100), {
    ok: false,
    retryAfter: 60,
    reason: "cooldown",
  });
  const afterCooldown = acquireTwilioCallPermit(62_000);
  assert.equal(afterCooldown.ok, true);
  if (afterCooldown.ok) afterCooldown.release();
});

test("the live-call route rejects cross-origin, non-JSON and client-controlled fields", async () => {
  configureTwilio();
  const crossOrigin = await callPost(
    controlledCallRequest('{"consent":true}', {
      origin: "https://attacker.test",
    }),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "cross_origin_request",
  );

  const nonJson = await callPost(
    controlledCallRequest('{"consent":true}', {
      contentType: "text/plain",
    }),
  );
  assert.equal(nonJson.status, 415);
  assert.equal((await nonJson.json()).error.code, "unsupported_media_type");

  const destination = await callPost(
    controlledCallRequest(
      JSON.stringify({ consent: true, destination: "+442079460000" }),
    ),
  );
  assert.equal(destination.status, 400);
  assert.equal((await destination.json()).error.code, "unexpected_field");
});

test("the live-call route blocks a concurrent request and starts cooldown only after queued", async () => {
  configureTwilio();
  let releaseProvider!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    globalThis.fetch = async () => {
      resolve();
      await new Promise<void>((release) => {
        releaseProvider = release;
      });
      return Response.json({
        sid: `CA${"b".repeat(32)}`,
        status: "queued",
      });
    };
  });

  const firstPromise = callPost(await authorisedCallRequest());
  await providerStarted;
  const second = await callPost(await authorisedCallRequest());
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "1");
  assert.equal((await second.json()).error.code, "call_rate_limited");

  releaseProvider();
  const first = await firstPromise;
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), {
    status: "queued",
    message:
      "The fixed synthetic provider call was queued. This does not confirm that it rang, was answered or completed.",
  });
  const cooldown = await callPost(await authorisedCallRequest());
  assert.equal(cooldown.status, 429);
  assert.match(cooldown.headers.get("retry-after") ?? "", /^(?:5[89]|60)$/);
});

test("a failed provider call releases the permit", async () => {
  configureTwilio();
  globalThis.fetch = async () => {
    throw new Error("controlled Twilio failure");
  };
  const failed = await callPost(await authorisedCallRequest());
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error.code, "call_provider_failed");
  assert.deepEqual(getTwilioCallGuardState(), {
    inFlight: false,
    cooldownRemainingMs: 0,
  });
  const available = acquireTwilioCallPermit();
  assert.equal(available.ok, true);
  if (available.ok) available.release();
});

test("the live-call route requires a fresh server-issued capability", async () => {
  configureTwilio();
  let networkUsed = false;
  globalThis.fetch = async () => {
    networkUsed = true;
    throw new Error("provider must not be called");
  };

  const missing = await callPost(
    controlledCallRequest('{"consent":true}'),
  );
  assert.equal(missing.status, 403);
  assert.equal(
    (await missing.json()).error.code,
    "provider_capability_required",
  );
  assert.equal(networkUsed, false);

  const basis = controlledCallRequest('{"consent":true}');
  const capability = await tokenFor(basis, "twilio");
  const mismatched = await callPost(
    controlledCallRequest('{"consent":true}', {
      capability: await tokenFor(basis, "elevenlabs"),
    }),
  );
  assert.equal(mismatched.status, 403);
  assert.equal(networkUsed, false);

  globalThis.fetch = async () =>
    Response.json({
      sid: `CA${"c".repeat(32)}`,
      status: "queued",
    });
  const accepted = await callPost(
    controlledCallRequest('{"consent":true}', { capability }),
  );
  assert.equal(accepted.status, 202);

  const replayed = await callPost(
    controlledCallRequest('{"consent":true}', { capability }),
  );
  assert.equal(replayed.status, 403);
  assert.equal(
    (await replayed.json()).error.code,
    "provider_capability_required",
  );
});

test("live calls fail closed in production without a distributed coordinator", async () => {
  configureTwilio();
  setNodeEnvironment("production");
  process.env.CARERELAY_DEMO_CAPABILITY_SECRET = "t".repeat(32);
  resetTwilioCallGuard();

  const unavailable = await callPost(await authorisedCallRequest());
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await unavailable.json()).error.code,
    "call_coordination_unavailable",
  );

  let queued = false;
  configureTwilioCallCoordinator({
    async acquire(now) {
      assert.ok(Number.isFinite(now));
      return {
        ok: true,
        async queued() {
          queued = true;
        },
        async release() {
          // No-op test lease release.
        },
      };
    },
  });
  globalThis.fetch = async () =>
    Response.json({
      sid: `CA${"d".repeat(32)}`,
      status: "queued",
    });
  const coordinated = await callPost(await authorisedCallRequest());
  assert.equal(coordinated.status, 202);
  assert.equal(queued, true);
});

test("a cooldown-coordination failure never claims an accepted call was not queued", async () => {
  configureTwilio();
  setNodeEnvironment("production");
  process.env.CARERELAY_DEMO_CAPABILITY_SECRET = "u".repeat(32);
  let released = false;
  configureTwilioCallCoordinator({
    async acquire() {
      return {
        ok: true,
        async queued() {
          throw new Error("controlled coordinator failure");
        },
        async release() {
          released = true;
        },
      };
    },
  });
  globalThis.fetch = async () =>
    Response.json({
      sid: `CA${"e".repeat(32)}`,
      status: "queued",
    });

  const response = await callPost(await authorisedCallRequest());
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "call_state_uncertain");
  assert.match(body.error.message, /provider accepted/i);
  assert.match(body.error.message, /do not retry/i);
  assert.equal(released, true);
});

test("the coordinated call permit exposes production fail-closed state", async () => {
  setNodeEnvironment("production");
  resetTwilioCallGuard();
  assert.deepEqual(await acquireCoordinatedTwilioCallPermit(1_000), {
    ok: false,
    retryAfter: 60,
    reason: "coordination-unavailable",
  });
});
