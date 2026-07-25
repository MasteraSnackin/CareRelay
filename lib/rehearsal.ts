import type { Fixture, FixtureId } from "./fixtures";

export const REHEARSAL_STEPS = [
  "Confirm this is referral administration.",
  "Give the selected reference.",
  "Ask about the documented administrative status.",
  "Repeat and record the next step.",
] as const;

export type RehearsalStatus = "idle" | "active" | "ended" | "completed";

export interface RehearsalResult {
  fixtureId: FixtureId;
  label: "Simulated outcome recorded";
  statusExplanation: string;
  nextAction: string;
  externalCallPlaced: false;
  externalCallNotice: "No external call was placed";
}

export interface RehearsalState {
  fixtureId: FixtureId;
  status: RehearsalStatus;
  consent: boolean;
  completedSteps: number;
  result: RehearsalResult | null;
  message: string;
}

export function createRehearsalState(fixtureId: FixtureId): RehearsalState {
  return {
    fixtureId,
    status: "idle",
    consent: false,
    completedSteps: 0,
    result: null,
    message: "",
  };
}

export function setRehearsalConsent(
  state: RehearsalState,
  consent: boolean,
): RehearsalState {
  if (state.status === "active") return state;
  return { ...state, consent };
}

export function startRehearsal(state: RehearsalState): RehearsalState {
  if (!state.consent || state.status === "active") return state;
  return {
    ...state,
    status: "active",
    completedSteps: 0,
    result: null,
    message: "Controlled mock line started. No external call was placed.",
  };
}

export function continueRehearsal(
  state: RehearsalState,
  fixture: Fixture,
): RehearsalState {
  if (state.status !== "active" || fixture.id !== state.fixtureId) {
    return state;
  }
  const completedSteps = Math.min(
    REHEARSAL_STEPS.length,
    state.completedSteps + 1,
  );
  if (completedSteps < REHEARSAL_STEPS.length) {
    return { ...state, completedSteps };
  }
  return {
    ...state,
    status: "completed",
    completedSteps,
    result: {
      fixtureId: fixture.id,
      label: "Simulated outcome recorded",
      statusExplanation: fixture.explanations.plain.summary,
      nextAction: `${fixture.nextAction.title}. ${fixture.nextAction.detail}`,
      externalCallPlaced: false,
      externalCallNotice: "No external call was placed",
    },
    message: "Mock enquiry outcome recorded. No external call was placed.",
  };
}

export function endRehearsal(state: RehearsalState): RehearsalState {
  if (state.status !== "active") return state;
  return {
    ...state,
    status: "ended",
    result: null,
    message: "Rehearsal ended. Nothing was recorded and no external call was placed.",
  };
}
