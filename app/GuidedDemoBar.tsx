"use client";

import { ArrowRightIcon, CheckIcon, CloseIcon } from "./icons";

export type GuidedStep = {
  label: string;
  action: string;
  description: string;
};

type GuidedDemoBarProps = {
  active: boolean;
  confirmed: readonly boolean[];
  currentStep: number;
  steps: readonly GuidedStep[];
  onAction: () => void;
  onExit: () => void;
  onNext: () => void;
  onResume: () => void;
};

export function GuidedDemoBar({
  active,
  confirmed,
  currentStep,
  steps,
  onAction,
  onExit,
  onNext,
  onResume,
}: GuidedDemoBarProps) {
  const completed = confirmed.filter(Boolean).length;
  const current = steps[currentStep];
  const ready = Boolean(confirmed[currentStep]);
  const isLast = currentStep === steps.length - 1;

  return (
    <section className="guided-card" aria-labelledby="guided-demo-title">
      <div className="guided-heading">
        <div>
          <p className="kicker kicker-on-dark">Guided synthetic demo</p>
          <h2 id="guided-demo-title">Show the evidence-backed journey</h2>
          <p className="guided-boundary">
            Prototype interaction evidence · not a clinical outcome
          </p>
        </div>
        {!active ? (
          <button className="button button-mint" type="button" onClick={onResume}>
            Resume guided demo
            <ArrowRightIcon />
          </button>
        ) : (
          <button
            aria-label="Pause guided demonstration"
            className="icon-button icon-button-dark"
            type="button"
            onClick={onExit}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div
        aria-label={`${completed} of ${steps.length} guided steps confirmed`}
        aria-valuemax={steps.length}
        aria-valuemin={0}
        aria-valuenow={completed}
        className="guided-progress"
        role="progressbar"
      >
        <span style={{ width: `${(completed / steps.length) * 100}%` }} />
      </div>

      <ol className="guided-steps">
        {steps.map((step, index) => {
          const state =
            confirmed[index] || index < currentStep
              ? "complete"
              : index === currentStep
                ? "current"
                : "upcoming";
          return (
            <li
              aria-current={index === currentStep ? "step" : undefined}
              className={`guided-step guided-step-${state}`}
              key={step.label}
            >
              <span className="guided-step-marker" aria-hidden="true">
                {state === "complete" ? <CheckIcon size={15} /> : index + 1}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>
                  {state === "complete"
                    ? "Confirmed"
                    : state === "current"
                      ? "Current"
                      : "Upcoming"}
                </small>
              </span>
            </li>
          );
        })}
      </ol>

      {active && current ? (
        <div className="guided-action">
          <div>
            <span className="guided-action-count">
              Step {currentStep + 1} of {steps.length}
            </span>
            <strong>{current.action}</strong>
            <p>{current.description}</p>
          </div>
          <div className="guided-action-buttons">
            {!ready ? (
              <button
                className="button button-mint"
                type="button"
                onClick={onAction}
              >
                {current.action}
              </button>
            ) : (
              <span className="guided-confirmed">
                <CheckIcon size={18} />
                Action confirmed
              </span>
            )}
            <button
              className="button button-light"
              disabled={!ready}
              type="button"
              onClick={onNext}
            >
              {isLast ? "Finish" : "Next"}
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      ) : (
        <p className="guided-paused" role="status">
          The guide is paused. Confirmed interaction evidence has been kept for
          the rheumatology synthetic fixture in this browser session.
        </p>
      )}
    </section>
  );
}
