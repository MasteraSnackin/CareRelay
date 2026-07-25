"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { EyeIcon, EyeOffIcon } from "../icons";

export type ProviderId = "anthropic" | "elevenlabs" | "twilio";

export type CredentialState = {
  anthropicKey: string;
  elevenlabsKey: string;
  elevenlabsModelId: string;
  elevenlabsVoiceId: string;
  twilioAccountSid: string;
  twilioAllowedNumber: string;
  twilioAuthToken: string;
  twilioEnabled: boolean;
  twilioFromNumber: string;
};

type CredentialFormProps = {
  credentials: CredentialState;
  disabled: boolean;
  loopbackHost: boolean;
  provider: ProviderId;
  showSecrets: Record<string, boolean>;
  onChange: Dispatch<SetStateAction<CredentialState>>;
  onClear: () => void;
  onShow: (key: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export function CredentialForm({
  credentials,
  disabled,
  loopbackHost,
  provider,
  showSecrets,
  onChange,
  onClear,
  onShow,
  onSubmit,
}: CredentialFormProps) {
  const actionsDisabled = disabled || !loopbackHost;
  const secretInput = (
    key: keyof CredentialState,
    label: string,
    value: string,
  ) => (
    <label className="secret-field">
      <span>{label}</span>
      <span className="secret-input">
        <input
          autoComplete="off"
          disabled={!loopbackHost}
          type={showSecrets[String(key)] ? "text" : "password"}
          value={value}
          onChange={(event) =>
            onChange((current) => ({ ...current, [key]: event.target.value }))
          }
        />
        <button
          aria-label={`${showSecrets[String(key)] ? "Hide" : "Show"} ${label}`}
          disabled={!loopbackHost}
          type="button"
          onClick={() => onShow(String(key))}
        >
          {showSecrets[String(key)] ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </label>
  );

  return (
    <form className="credential-form" onSubmit={onSubmit}>
      <div className="credential-heading">
        <div>
          <strong>Temporary local credential entry</strong>
          <small>
            {loopbackHost
              ? "Stored in server-process memory only; never returned to this browser."
              : "Disabled because this is not a loopback development host."}
          </small>
        </div>
        <span className={loopbackHost ? "local-badge" : "public-badge"}>
          {loopbackHost ? "Loopback only" : "Public host · disabled"}
        </span>
      </div>
      <div className="credential-grid">
        {provider === "anthropic" ? (
          secretInput("anthropicKey", "Claude API key", credentials.anthropicKey)
        ) : provider === "elevenlabs" ? (
          <>
            {secretInput(
              "elevenlabsKey",
              "ElevenLabs API key",
              credentials.elevenlabsKey,
            )}
            <label>
              <span>Voice ID</span>
              <input
                autoComplete="off"
                disabled={!loopbackHost}
                value={credentials.elevenlabsVoiceId}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    elevenlabsVoiceId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Optional model ID</span>
              <input
                autoComplete="off"
                disabled={!loopbackHost}
                placeholder="eleven_multilingual_v2"
                value={credentials.elevenlabsModelId}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    elevenlabsModelId: event.target.value,
                  }))
                }
              />
            </label>
          </>
        ) : (
          <>
            <label>
              <span>Account SID</span>
              <input
                autoComplete="off"
                disabled={!loopbackHost}
                value={credentials.twilioAccountSid}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    twilioAccountSid: event.target.value,
                  }))
                }
              />
            </label>
            {secretInput(
              "twilioAuthToken",
              "Auth token",
              credentials.twilioAuthToken,
            )}
            <label>
              <span>From number</span>
              <input
                autoComplete="off"
                disabled={!loopbackHost}
                inputMode="tel"
                value={credentials.twilioFromNumber}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    twilioFromNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Allowed destination</span>
              <input
                autoComplete="off"
                disabled={!loopbackHost}
                inputMode="tel"
                value={credentials.twilioAllowedNumber}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    twilioAllowedNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label className="credential-toggle">
              <input
                checked={credentials.twilioEnabled}
                disabled={!loopbackHost}
                type="checkbox"
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    twilioEnabled: event.target.checked,
                  }))
                }
              />
              Enable the fixed live-call path
            </label>
          </>
        )}
      </div>
      <div className="credential-actions">
        <button
          className="button button-primary"
          disabled={actionsDisabled}
          type="submit"
        >
          Save temporarily
        </button>
        <button
          className="button button-quiet"
          disabled={actionsDisabled}
          type="button"
          onClick={onClear}
        >
          Clear runtime values
        </button>
      </div>
    </form>
  );
}
