import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoSession,
  recordDemoEvent,
  resetDemoSession,
} from "../lib/demo-session";

test("starts with no synthetic interaction evidence", () => {
  assert.deepEqual(createDemoSession(100), {
    startedAt: 100,
    lastEventAt: 100,
    documentAnalysed: false,
    citationsOpened: 0,
    correctActionSelected: false,
    rehearsalCompleted: false,
    timeToFirstCorrectActionMs: null,
  });
  assert.throws(() => createDemoSession(-1), /non-negative monotonic/);
  assert.throws(() => createDemoSession(Number.NaN), /non-negative monotonic/);
});

test("records only confirmed events in the required order", () => {
  const initial = createDemoSession(1_000);

  const ignoredCitation = recordDemoEvent(initial, {
    type: "citation-opened",
    at: 1_010,
  });
  assert.equal(ignoredCitation, initial);
  const ignoredAction = recordDemoEvent(initial, {
    type: "correct-action-selected",
    at: 1_020,
  });
  assert.equal(ignoredAction, initial);
  const ignoredRehearsal = recordDemoEvent(initial, {
    type: "rehearsal-completed",
    at: 1_030,
  });
  assert.equal(ignoredRehearsal, initial);

  const analysed = recordDemoEvent(initial, {
    type: "document-analysed",
    at: 1_100,
  });
  const cited = recordDemoEvent(analysed, {
    type: "citation-opened",
    at: 1_250,
  });
  const action = recordDemoEvent(cited, {
    type: "correct-action-selected",
    at: 1_500,
  });
  const completed = recordDemoEvent(action, {
    type: "rehearsal-completed",
    at: 1_900,
  });

  assert.deepEqual(completed, {
    startedAt: 1_000,
    lastEventAt: 1_900,
    documentAnalysed: true,
    citationsOpened: 1,
    correctActionSelected: true,
    rehearsalCompleted: true,
    timeToFirstCorrectActionMs: 500,
  });
});

test("ignores duplicate, pre-session and non-monotonic events", () => {
  const initial = createDemoSession(500);
  assert.equal(
    recordDemoEvent(initial, { type: "document-analysed", at: 499 }),
    initial,
  );
  assert.equal(
    recordDemoEvent(initial, {
      type: "document-analysed",
      at: Number.POSITIVE_INFINITY,
    }),
    initial,
  );

  const analysed = recordDemoEvent(initial, {
    type: "document-analysed",
    at: 600,
  });
  assert.equal(
    recordDemoEvent(analysed, { type: "document-analysed", at: 700 }),
    analysed,
  );
  assert.equal(
    recordDemoEvent(analysed, { type: "citation-opened", at: 599 }),
    analysed,
  );

  const cited = recordDemoEvent(analysed, {
    type: "citation-opened",
    at: 700,
  });
  const action = recordDemoEvent(cited, {
    type: "correct-action-selected",
    at: 800,
  });
  assert.equal(
    recordDemoEvent(action, {
      type: "correct-action-selected",
      at: 900,
    }),
    action,
  );
  const completed = recordDemoEvent(action, {
    type: "rehearsal-completed",
    at: 900,
  });
  assert.equal(
    recordDemoEvent(completed, { type: "rehearsal-completed", at: 1_000 }),
    completed,
  );
});

test("reset clears all evidence and starts a new monotonic session", () => {
  let session = createDemoSession(10);
  session = recordDemoEvent(session, {
    type: "document-analysed",
    at: 20,
  });
  session = recordDemoEvent(session, { type: "citation-opened", at: 30 });

  assert.deepEqual(resetDemoSession(1_000), createDemoSession(1_000));
  assert.notDeepEqual(resetDemoSession(1_000), session);
});
