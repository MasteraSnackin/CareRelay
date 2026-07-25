import type { FixtureId } from "./fixtures";
import {
  createProviderDeadline,
  type ProviderDeadline,
} from "./provider-deadline";
import { getElevenLabsConfig } from "./runtime-secrets";

export const MAX_ELEVENLABS_AUDIO_BYTES = 5 * 1024 * 1024;
const APPROVED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
]);

export interface ApprovedSpeech {
  fixtureId: FixtureId;
  text: string;
  language: "en-GB" | "cy-GB" | "pl-PL";
}

export const APPROVED_SPEECH = {
  "rheumatology-plain": {
    fixtureId: "rheumatology",
    text: "The rheumatology team received the synthetic referral. It has not been accepted and no appointment has been booked. Contact the referral team and quote C R R H E four one zero one.",
    language: "en-GB",
  },
  "rheumatology-cy": {
    fixtureId: "rheumatology",
    text: "Mae'r tîm rhiwmatoleg wedi cael yr atgyfeiriad synthetig. Nid yw wedi'i dderbyn ac nid oes apwyntiad wedi'i drefnu.",
    language: "cy-GB",
  },
  "rheumatology-pl": {
    fixtureId: "rheumatology",
    text: "Zespół reumatologii otrzymał syntetyczne skierowanie. Nie zostało ono przyjęte i nie umówiono wizyty.",
    language: "pl-PL",
  },
  "diabetes-plain": {
    fixtureId: "diabetes",
    text: "The synthetic diabetes clinic appointment is booked for Wednesday 5 August 2026 at 10:20. Arrive at 10:10.",
    language: "en-GB",
  },
  "cardiology-plain": {
    fixtureId: "cardiology",
    text: "The synthetic cardiology referral is waiting for a copy of an existing record. Ask the GP practice whether the copy was sent. This is not a request to arrange a new test.",
    language: "en-GB",
  },
} as const satisfies Record<string, ApprovedSpeech>;

export type ApprovedSpeechId = keyof typeof APPROVED_SPEECH;

export function isApprovedSpeechId(value: unknown): value is ApprovedSpeechId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(APPROVED_SPEECH, value)
  );
}

export function resolveApprovedSpeech(
  fixtureId: FixtureId,
  speechId: string,
): ApprovedSpeech | undefined {
  if (!isApprovedSpeechId(speechId)) {
    return undefined;
  }
  const speech = APPROVED_SPEECH[speechId];
  return speech.fixtureId === fixtureId ? speech : undefined;
}

async function readResponseBytes(
  response: Response,
  maximum: number,
  deadline: ProviderDeadline,
): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (
    lengthHeader &&
    (/^\d+$/u.test(lengthHeader) === false ||
      Number(lengthHeader) > maximum)
  ) {
    throw new Error("Provider media exceeds the permitted size.");
  }
  if (!response.body) {
    throw new Error("Provider returned no media.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Provider media exceeds the permitted size.");
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader
      .cancel("provider response interrupted")
      .catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface SynthesisedSpeech {
  bytes: Uint8Array;
  contentType: string;
  language: ApprovedSpeech["language"];
}

export async function synthesiseApprovedSpeech(
  fixtureId: FixtureId,
  speechId: string,
  fetchImpl: typeof fetch = fetch,
  {
    signal,
    timeoutMs = 12_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SynthesisedSpeech> {
  const speech = resolveApprovedSpeech(fixtureId, speechId);
  if (!speech) {
    throw new Error("Speech identifier is not approved for this fixture.");
  }
  const config = getElevenLabsConfig();
  if (!config.apiKey || !config.voiceId) {
    throw new Error("ElevenLabs is not configured.");
  }

  const deadline = createProviderDeadline(timeoutMs, signal);
  try {
    const response = await deadline.race(
      fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`,
        {
          method: "POST",
          headers: {
            Accept: "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": config.apiKey,
          },
          body: JSON.stringify({
            text: speech.text,
            model_id: config.modelId,
          }),
          signal: deadline.signal,
        },
      ),
    );
    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ??
      "";
    if (!response.ok || !APPROVED_AUDIO_TYPES.has(contentType)) {
      throw new Error("ElevenLabs did not return approved audio.");
    }
    const bytes = await readResponseBytes(
      response,
      MAX_ELEVENLABS_AUDIO_BYTES,
      deadline,
    );
    if (bytes.byteLength === 0) {
      throw new Error("ElevenLabs returned empty audio.");
    }
    return { bytes, contentType, language: speech.language };
  } finally {
    deadline.close();
  }
}

export async function checkElevenLabsReadiness(
  fetchImpl: typeof fetch = fetch,
  {
    signal,
    timeoutMs = 8_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  const config = getElevenLabsConfig();
  if (!config.apiKey || !config.voiceId) {
    return false;
  }
  const deadline = createProviderDeadline(timeoutMs, signal);
  try {
    const response = await deadline.race(
      fetchImpl("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": config.apiKey },
        signal: deadline.signal,
      }),
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    deadline.close();
  }
}
