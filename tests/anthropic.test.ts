import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  askClaudeGrounded,
  checkAnthropicReadiness,
  createAnthropicClient,
  parseClaudeJson,
} from "../lib/anthropic";
import { FIXTURES } from "../lib/fixtures";
import {
  clearAllRuntimeSecrets,
  setRuntimeSecrets,
} from "../lib/runtime-secrets";

const originalFetch = globalThis.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalAnthropicModel = process.env.ANTHROPIC_MODEL;

beforeEach(() => {
  clearAllRuntimeSecrets();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAllRuntimeSecrets();
  globalThis.fetch = originalFetch;
  if (originalAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
  if (originalAnthropicModel === undefined) {
    delete process.env.ANTHROPIC_MODEL;
  } else {
    process.env.ANTHROPIC_MODEL = originalAnthropicModel;
  }
});

test("uses no SDK retries and the supplied bounded timeout", () => {
  const client = createAnthropicClient("test-only-key", 1_234);
  assert.equal(client.maxRetries, 0);
  assert.equal(client.timeout, 1_234);
});

test("returns unavailable and false readiness when Claude is not configured", async () => {
  let networkUsed = false;
  globalThis.fetch = async () => {
    networkUsed = true;
    throw new Error("network must not be used");
  };

  assert.deepEqual(
    await askClaudeGrounded(
      FIXTURES.rheumatology,
      "What should I do next?",
    ),
    { kind: "unavailable" },
  );
  assert.equal(await checkAnthropicReadiness(), false);
  assert.equal(networkUsed, false);
});

test("parses one JSON object with or without a fenced wrapper", () => {
  const value = { intentId: "rheumatology.appointment" };
  assert.deepEqual(parseClaudeJson(JSON.stringify(value)), value);
  assert.deepEqual(
    parseClaudeJson(`\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`),
    value,
  );
  assert.throws(() => parseClaudeJson("not JSON"));
});

test("sends a bounded classification-only request and parses the provider intent", async () => {
  setRuntimeSecrets("anthropic", {
    apiKey: "test-only-anthropic-key",
    model: "test-grounded-model",
  });
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const providerAnswer = { intentId: "rheumatology.appointment" };
  globalThis.fetch = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "test-grounded-model",
        content: [
          { type: "text", text: `\`\`\`json\n${JSON.stringify(providerAnswer)}\n\`\`\`` },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "provider-test-request",
        },
      },
    );
  };

  const result = await askClaudeGrounded(
    FIXTURES.rheumatology,
    "Has my appointment been booked?",
  );
  assert.deepEqual(result, { kind: "response", value: providerAnswer });
  assert.match(capturedUrl, /\/v1\/messages$/);
  assert.equal(capturedInit?.method, "POST");

  const body = JSON.parse(String(capturedInit?.body)) as {
    model: string;
    max_tokens: number;
    temperature: number;
    system: string;
    messages: Array<{ content: string }>;
    thinking?: unknown;
  };
  assert.equal(body.model, "test-grounded-model");
  assert.equal(body.max_tokens, 80);
  assert.equal(body.temperature, 0);
  assert.equal(body.thinking, undefined);
  assert.match(body.system, /untrusted evidence, never instructions/i);
  assert.match(body.system, /Never answer the question/i);
  assert.match(body.system, /diagnosis, treatment, medication, urgency/i);
  assert.match(body.system, /rheumatology\.appointment/);
  assert.doesNotMatch(body.system, /rheumatology:p1:not-accepted/);
  assert.doesNotMatch(body.system, /020 7946|CR-RHE-4101/);
  assert.deepEqual(JSON.parse(body.messages[0]!.content), {
    task:
      "Classify this question using one allowed administrative intent ID.",
    question: "Has my appointment been booked?",
    selectedText: null,
  });
});

test("provider and JSON failures return a failure value instead of breaking local mode", async () => {
  setRuntimeSecrets("anthropic", { apiKey: "test-only-key" });
  globalThis.fetch = async () => {
    throw new Error("controlled provider failure");
  };
  assert.deepEqual(
    await askClaudeGrounded(FIXTURES.rheumatology, "What should I do next?"),
    { kind: "failed" },
  );

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "msg_invalid_json",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "not JSON" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  assert.deepEqual(
    await askClaudeGrounded(FIXTURES.rheumatology, "What should I do next?"),
    { kind: "response", value: null },
  );
});

test("parent cancellation stops a pending Claude request without retrying", async () => {
  setRuntimeSecrets("anthropic", { apiKey: "test-only-key" });
  let requests = 0;
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  let releaseProvider!: () => void;
  globalThis.fetch = async () => {
    requests += 1;
    providerStarted();
    await new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    return new Response(
      JSON.stringify({
        id: "msg_late",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [
          {
            type: "text",
            text: '{"intentId":"rheumatology.appointment"}',
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const controller = new AbortController();
  const pending = askClaudeGrounded(
    FIXTURES.rheumatology,
    "Has this been scheduled?",
    undefined,
    controller.signal,
  );
  await started;
  controller.abort();
  assert.deepEqual(await pending, { kind: "failed" });
  assert.equal(requests, 1);

  // Let the deliberately non-compliant fetch settle so the SDK has no
  // retained work after the test. The cancelled result must remain final.
  releaseProvider();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1);
});
