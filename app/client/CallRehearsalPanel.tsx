"use client";

import { forwardRef } from "react";
import type { Fixture } from "@/lib/fixtures";
import {
  REHEARSAL_STEPS,
  type RehearsalResult,
  type RehearsalState,
} from "@/lib/rehearsal";
import {
  ArrowRightIcon,
  CheckIcon,
  PhoneIcon,
} from "../icons";

type CallRehearsalPanelProps = {
  callMessage: string;
  callSeconds: number;
  fixture: Fixture;
  liveCallMessage: string;
  liveCallState: "idle" | "sending" | "queued" | "error";
  liveConsent: boolean;
  providerReady: boolean;
  rehearsal: RehearsalState;
  rehearsalResult?: RehearsalResult;
  onAdvance: () => void;
  onConsent: (value: boolean) => void;
  onEnd: () => void;
  onLiveConsent: (value: boolean) => void;
  onQueueLiveCall: () => void;
  onStart: () => void;
};

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export const CallRehearsalPanel = forwardRef<
  HTMLElement,
  CallRehearsalPanelProps
>(function CallRehearsalPanel(
  {
    callMessage,
    callSeconds,
    fixture,
    liveCallMessage,
    liveCallState,
    liveConsent,
    providerReady,
    rehearsal,
    rehearsalResult,
    onAdvance,
    onConsent,
    onEnd,
    onLiveConsent,
    onQueueLiveCall,
    onStart,
  },
  ref,
) {
  const callStep = rehearsal.completedSteps;
  const callState = rehearsal.status;
  const visibleResult = rehearsalResult ?? rehearsal.result;

  return (
    <section
      className="call-panel"
      ref={ref}
      aria-labelledby="call-panel-title"
    >
      <div className="call-intro">
        <p className="kicker kicker-on-dark">Controlled rehearsal</p>
        <h2 id="call-panel-title">
          Rehearse the clinic call before it is real.
        </h2>
        <p>
          The standard path remains on this device. It does not dial, listen to
          or record a real call.
        </p>
        <ol className="call-script">
          {REHEARSAL_STEPS.map((step, index) => (
            <li
              className={
                callState === "active" && callStep === index
                  ? "call-script-active"
                  : callState === "completed" || callStep > index
                    ? "call-script-complete"
                    : ""
              }
              key={step}
            >
              <span>
                {callState === "completed" || callStep > index ? (
                  <CheckIcon size={15} />
                ) : (
                  index + 1
                )}
              </span>
              {step}
            </li>
          ))}
        </ol>
        {callState !== "active" && callState !== "completed" ? (
          <div className="call-consent">
            <label>
              <input
                checked={rehearsal.consent}
                type="checkbox"
                onChange={(event) => onConsent(event.target.checked)}
              />
              <span>
                I understand this uses synthetic data and will not place a real
                call.
              </span>
            </label>
            <button
              className="button button-mint"
              disabled={!rehearsal.consent}
              type="button"
              onClick={onStart}
            >
              <PhoneIcon size={17} />
              Start controlled rehearsal
            </button>
          </div>
        ) : null}
      </div>
      <div className="mock-line">
        {callState === "active" ? (
          <>
            <div className="mock-line-top">
              <span className="line-status">
                <span />
                Controlled mock line
              </span>
              <time aria-label={`Simulated elapsed time ${formatElapsed(callSeconds)}`}>
                {formatElapsed(callSeconds)}
              </time>
            </div>
            <div className="mock-clinic">
              <span className="mock-avatar" aria-hidden="true">
                NR
              </span>
              <span>
                <strong>{fixture.contact}</strong>
                <small>Fictional clinic team</small>
              </span>
            </div>
            <div className="waveform" aria-hidden="true">
              {[8, 15, 23, 12, 29, 18, 9, 25, 34, 16, 27, 11, 20, 30, 14, 8].map(
                (height, index) => (
                  <span key={index} style={{ height }} />
                ),
              )}
            </div>
            <div className="prompt-bubble">
              <span>{callStep % 2 === 0 ? "Referral desk" : "Your prompt"}</span>
              <p>
                {callStep === 0
                  ? "“Referral administration, how can I help?”"
                  : callStep === 1
                    ? `“My synthetic reference is ${fixture.reference}.”`
                    : callStep === 2
                      ? `“Could you confirm the documented status: ${fixture.status.toLowerCase()}?”`
                      : `“I will note the next step: ${fixture.nextAction.title}.”`}
              </p>
            </div>
            <div className="mock-line-actions">
              <button
                className="button button-mint"
                type="button"
                onClick={onAdvance}
              >
                {callStep === REHEARSAL_STEPS.length - 1
                  ? "Finish rehearsal"
                  : "Continue"}
                <ArrowRightIcon size={17} />
              </button>
              <button
                className="button button-dark-quiet"
                type="button"
                onClick={onEnd}
              >
                End rehearsal
              </button>
            </div>
          </>
        ) : visibleResult || callState === "completed" ? (
          <div className="recorded-outcome">
            <span className="recorded-check">
              <CheckIcon size={25} />
            </span>
            <p className="kicker kicker-on-dark">Simulated outcome recorded</p>
            <h3>{visibleResult?.statusExplanation}</h3>
            <p>{visibleResult?.nextAction}</p>
            <strong>No external call was placed</strong>
          </div>
        ) : (
          <div className="mock-line-empty">
            <PhoneIcon size={31} />
            <h3>Controlled mock line</h3>
            <p>
              Consent and all four deliberate steps are required before an
              outcome can be recorded.
            </p>
          </div>
        )}
        <p className="call-live" aria-live="polite" role="status">
          {callMessage}
        </p>
      </div>
      <details className="live-call-details">
        <summary>Optional fixed provider test call</summary>
        <div>
          <p>
            This separate path is locked unless Twilio, one fixed destination
            and the disabled-by-default live-call flag are ready. It does not
            accept a number, caller ID or spoken content from this browser.
          </p>
          <label>
            <input
              checked={liveConsent}
              disabled={!providerReady || liveCallState === "sending"}
              type="checkbox"
              onChange={(event) => onLiveConsent(event.target.checked)}
            />
            I explicitly consent to one fixed, synthetic provider test call.
          </label>
          <button
            className="button button-light"
            disabled={
              !providerReady ||
              !liveConsent ||
              liveCallState === "sending"
            }
            type="button"
            onClick={onQueueLiveCall}
          >
            {liveCallState === "sending"
              ? "Requesting…"
              : "Queue fixed test call"}
          </button>
          <p aria-live="polite" role="status">
            {providerReady
              ? liveCallMessage ||
                "Provider controls are ready; separate consent is required."
              : "Locked. Twilio readiness and the live-call flag are required."}
          </p>
        </div>
      </details>
    </section>
  );
});
