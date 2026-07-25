import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURES } from "../lib/fixtures";
import {
  REHEARSAL_STEPS,
  continueRehearsal,
  createRehearsalState,
  endRehearsal,
  setRehearsalConsent,
  startRehearsal,
} from "../lib/rehearsal";

test("does not start without explicit synthetic-data consent", () => {
  const idle = createRehearsalState("rheumatology");
  assert.equal(startRehearsal(idle), idle);

  const consented = setRehearsalConsent(idle, true);
  const active = startRehearsal(consented);
  assert.equal(active.status, "active");
  assert.equal(active.consent, true);
  assert.equal(active.completedSteps, 0);
  assert.equal(active.result, null);
  assert.match(active.message, /No external call was placed/);
  assert.equal(setRehearsalConsent(active, false), active);
});

test("requires all four local steps in order before recording an outcome", () => {
  assert.deepEqual(REHEARSAL_STEPS, [
    "Confirm this is referral administration.",
    "Give the selected reference.",
    "Ask about the documented administrative status.",
    "Repeat and record the next step.",
  ]);

  let state = startRehearsal(
    setRehearsalConsent(createRehearsalState("rheumatology"), true),
  );
  for (let index = 0; index < REHEARSAL_STEPS.length - 1; index += 1) {
    state = continueRehearsal(state, FIXTURES.rheumatology);
    assert.equal(state.status, "active");
    assert.equal(state.completedSteps, index + 1);
    assert.equal(state.result, null);
  }

  state = continueRehearsal(state, FIXTURES.rheumatology);
  assert.equal(state.status, "completed");
  assert.equal(state.completedSteps, 4);
  assert.deepEqual(state.result, {
    fixtureId: "rheumatology",
    label: "Simulated outcome recorded",
    statusExplanation: FIXTURES.rheumatology.explanations.plain.summary,
    nextAction:
      "Contact the referral team. Ask whether the referral has been reviewed and quote CR-RHE-4101.",
    externalCallPlaced: false,
    externalCallNotice: "No external call was placed",
  });
  assert.match(state.message, /Mock enquiry outcome recorded/);
  assert.match(state.message, /No external call was placed/);
  assert.equal(continueRehearsal(state, FIXTURES.rheumatology), state);
});

test("a mismatched case cannot advance an active rehearsal", () => {
  const active = startRehearsal(
    setRehearsalConsent(createRehearsalState("rheumatology"), true),
  );
  assert.equal(continueRehearsal(active, FIXTURES.diabetes), active);
});

test("ending early records nothing and states that no call was placed", () => {
  let active = startRehearsal(
    setRehearsalConsent(createRehearsalState("cardiology"), true),
  );
  active = continueRehearsal(active, FIXTURES.cardiology);
  const ended = endRehearsal(active);

  assert.equal(ended.status, "ended");
  assert.equal(ended.result, null);
  assert.match(ended.message, /Nothing was recorded/);
  assert.match(ended.message, /no external call was placed/i);
  assert.equal(endRehearsal(ended), ended);
});

test("creating state for a new case clears consent, progress and outcome", () => {
  const nextCase = createRehearsalState("diabetes");
  assert.deepEqual(nextCase, {
    fixtureId: "diabetes",
    status: "idle",
    consent: false,
    completedSteps: 0,
    result: null,
    message: "",
  });
});
