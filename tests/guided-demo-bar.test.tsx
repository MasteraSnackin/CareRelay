import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GuidedDemoBar,
  type GuidedStep,
} from "../app/GuidedDemoBar";

const steps: readonly GuidedStep[] = [
  {
    label: "Reset",
    action: "Reset the workspace",
    description: "Begin with fresh browser-memory evidence.",
  },
  {
    label: "Upload synthetic PDF",
    action: "Upload the supplied fixture",
    description: "Use the exact two-page synthetic document.",
  },
  {
    label: "Clarify",
    action: "Ask a grounded question",
    description: "Confirm an administrative explanation.",
  },
  {
    label: "Inspect citation",
    action: "Open its source",
    description: "Check the exact passage and page.",
  },
  {
    label: "Prepare call",
    action: "Start the local rehearsal",
    description: "No telephone call is placed.",
  },
  {
    label: "Record outcome",
    action: "Complete all four rehearsal steps",
    description: "Record a simulated outcome locally.",
  },
] as const;

const noOp = () => undefined;

function renderBar({
  active = true,
  confirmed = [true, false, false, false, false, false],
  currentStep = 1,
}: {
  active?: boolean;
  confirmed?: readonly boolean[];
  currentStep?: number;
} = {}) {
  return renderToStaticMarkup(
    <GuidedDemoBar
      active={active}
      confirmed={confirmed}
      currentStep={currentStep}
      steps={steps}
      onAction={noOp}
      onExit={noOp}
      onNext={noOp}
      onResume={noOp}
    />,
  );
}

test("renders a manual six-step guide with accessible progress", () => {
  const html = renderBar();

  assert.match(html, /Guided synthetic demo/);
  assert.match(html, /Prototype interaction evidence · not a clinical outcome/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="6"/);
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /aria-label="Pause guided demonstration"/);

  for (const step of steps) {
    assert.match(html, new RegExp(step.label));
  }
});

test("does not enable Next before the current action is confirmed", () => {
  const blocked = renderBar({
    confirmed: [true, false, false, false, false, false],
    currentStep: 1,
  });
  assert.match(blocked, /<button[^>]*disabled=""[^>]*>Next/);
  assert.match(blocked, /Upload the supplied fixture/);

  const ready = renderBar({
    confirmed: [true, true, false, false, false, false],
    currentStep: 1,
  });
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Next/);
  assert.match(ready, /Action confirmed/);
  assert.match(ready, /aria-valuenow="2"/);
});

test("exiting keeps confirmed progress visible and exposes Resume", () => {
  const html = renderBar({
    active: false,
    confirmed: [true, true, true, false, false, false],
    currentStep: 3,
  });

  assert.match(html, /Resume guided demo/);
  assert.match(html, /confirmed interaction evidence has been kept/i);
  assert.match(html, /aria-valuenow="3"/);
  assert.doesNotMatch(html, />Next</);
});

test("labels the final manual transition Finish", () => {
  const html = renderBar({
    confirmed: [true, true, true, true, true, true],
    currentStep: 5,
  });
  assert.match(html, />Finish/);
  assert.match(html, /aria-valuenow="6"/);
});
