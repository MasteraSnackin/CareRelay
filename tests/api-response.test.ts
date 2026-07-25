import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  assertOnlyKeys,
  assertPlainObject,
  errorResponse,
  handleApiRoute,
  isJsonMediaType,
  isLoopbackHostname,
  jsonResponse,
  requestIdFor,
  requireSameOrigin,
} from "../lib/api-response";

test("accepts only bounded, log-safe request identifiers", () => {
  const accepted = new Request("https://example.test/api/check", {
    headers: { "x-request-id": "request_2026-07-25:abc.1" },
  });
  assert.equal(requestIdFor(accepted), "request_2026-07-25:abc.1");

  for (const rejected of [
    "",
    " includes spaces ",
    "contains/question",
    "contains,comma",
    "x".repeat(65),
  ]) {
    const request = new Request("https://example.test/api/check", {
      headers: { "x-request-id": rejected },
    });
    const generated = requestIdFor(request);
    assert.notEqual(generated, rejected);
    assert.match(
      generated,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  }
});

test("uses the same request identifier in normalised errors and headers", async () => {
  const response = await handleApiRoute(
    new Request("https://example.test/api/check", {
      headers: { "x-request-id": "known-request-id" },
    }),
    async () => {
      throw new ApiError("known_failure", "The controlled check failed.", 422);
    },
  );

  assert.equal(response.status, 422);
  assert.equal(response.headers.get("x-request-id"), "known-request-id");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "known_failure",
      message: "The controlled check failed.",
    },
    requestId: "known-request-id",
  });
});

test("normalises unknown errors without disclosing their content", async () => {
  const sensitive =
    "question=What medication should I take? key=sk-do-not-disclose";
  const response = errorResponse("redacted-request", new Error(sensitive));
  const serialised = JSON.stringify(await response.json());

  assert.equal(response.status, 500);
  assert.doesNotMatch(serialised, /medication|sk-do-not-disclose/i);
  assert.match(serialised, /internal_error/);
});

test("logs unexpected failures once with correlation but no sensitive content", async () => {
  const sensitive =
    "question=What medication should I take? key=sk-do-not-disclose";
  const originalError = console.error;
  const diagnostics: unknown[][] = [];
  console.error = (...values: unknown[]) => {
    diagnostics.push(values);
  };
  try {
    const response = await handleApiRoute(
      new Request("https://example.test/api/provider-check?key=secret", {
        method: "POST",
        headers: { "x-request-id": "safe-diagnostic-id" },
      }),
      async () => {
        throw new Error(sensitive);
      },
    );

    assert.equal(response.status, 500);
    assert.deepEqual(diagnostics, [
      [
        "CareRelay API request failed",
        {
          event: "api.unexpected_error",
          requestId: "safe-diagnostic-id",
          method: "POST",
          pathname: "/api/provider-check",
        },
      ],
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /medication|secret|sk-/i);
  } finally {
    console.error = originalError;
  }
});

test("JSON success responses are transient and correlated", async () => {
  const response = jsonResponse("success-request", { ready: true });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "success-request");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ready: true });
});

test("recognises application/json with optional parameters only", () => {
  assert.equal(
    isJsonMediaType(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    ),
    true,
  );
  assert.equal(
    isJsonMediaType(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "text/json" },
      }),
    ),
    false,
  );
  assert.equal(
    isJsonMediaType(
      new Request("https://example.test", {
        method: "POST",
      }),
    ),
    false,
  );
});

test("requires exact same-origin and fails closed on conflicting host headers", () => {
  const sameOrigin = new Request("https://care-relay.test/api/calls/mock", {
    headers: {
      host: "care-relay.test",
      origin: "https://care-relay.test",
    },
  });
  assert.equal(requireSameOrigin(sameOrigin).origin, "https://care-relay.test");

  const crossOrigin = new Request("https://care-relay.test/api/calls/mock", {
    headers: {
      host: "care-relay.test",
      origin: "https://attacker.test",
    },
  });
  assert.throws(
    () => requireSameOrigin(crossOrigin),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "cross_origin_request" &&
      error.status === 403,
  );

  const conflicting = new Request("https://care-relay.test/api/calls/mock", {
    headers: {
      host: "care-relay.test",
      origin: "https://care-relay.test",
      "x-forwarded-host": "different.test",
    },
  });
  assert.throws(
    () => requireSameOrigin(conflicting),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "conflicting_host_headers" &&
      error.status === 403,
  );
});

test("loopback allow-list excludes lookalike and public hosts", () => {
  for (const allowed of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLoopbackHostname(allowed), true, allowed);
  }
  for (const rejected of [
    "localhost.example",
    "127.0.0.2",
    "0.0.0.0",
    "care-relay.test",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isLoopbackHostname(rejected), false, rejected);
  }
});

test("plain-object and exact-key checks reject ambiguous request shapes", () => {
  for (const value of [null, [], "text", 1]) {
    assert.throws(
      () => assertPlainObject(value),
      (error: unknown) =>
        error instanceof ApiError && error.code === "invalid_request",
    );
  }

  const valid: unknown = { consent: true };
  assertPlainObject(valid);
  assert.doesNotThrow(() => assertOnlyKeys(valid, ["consent"]));
  assert.throws(
    () => assertOnlyKeys({ consent: true, destination: "020 7946 0000" }, ["consent"]),
    (error: unknown) =>
      error instanceof ApiError && error.code === "unexpected_field",
  );
});
