import {
  createProviderDeadline,
  type ProviderDeadline,
} from "./provider-deadline";
import { getTwilioConfig, isTwilioLiveCallReady } from "./runtime-secrets";

export const TWILIO_FIXED_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-GB">This is a controlled CareRelay synthetic demonstration call. No patient information is included. This is not a request for clinical advice. The synthetic referral reference is C R R H E four one zero one. This demonstration will now end.</Say><Hangup/></Response>';

export interface QueuedTwilioCall {
  sid: string;
  status: "queued";
}

function basicAuthentication(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

async function boundedJson(
  response: Response,
  deadline: ProviderDeadline,
): Promise<unknown> {
  const maximum = 64 * 1024;
  const lengthHeader = response.headers.get("content-length");
  if (
    lengthHeader &&
    (!/^\d+$/u.test(lengthHeader) ||
      !Number.isSafeInteger(Number(lengthHeader)) ||
      Number(lengthHeader) > maximum)
  ) {
    throw new Error("Provider response is too large.");
  }
  if (!response.body) return undefined;
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
        throw new Error("Provider response is too large.");
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
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function queueControlledTwilioCall(
  fetchImpl: typeof fetch = fetch,
  {
    signal,
    timeoutMs = 12_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<QueuedTwilioCall> {
  if (!isTwilioLiveCallReady()) {
    throw new Error("Controlled Twilio calling is not enabled.");
  }
  const config = getTwilioConfig();
  const form = new URLSearchParams({
    To: config.allowedToNumber,
    From: config.fromNumber,
    Twiml: TWILIO_FIXED_TWIML,
  });
  const deadline = createProviderDeadline(timeoutMs, signal);
  try {
    const response = await deadline.race(
      fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: basicAuthentication(
              config.accountSid,
              config.authToken,
            ),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: deadline.signal,
        },
      ),
    );
    const result = await boundedJson(response, deadline);
    if (
      !response.ok ||
      !isRecord(result) ||
      typeof result.sid !== "string" ||
      !/^CA[0-9a-f]{32}$/iu.test(result.sid) ||
      result.status !== "queued"
    ) {
      throw new Error("Twilio did not return a valid queued call.");
    }
    return { sid: result.sid, status: "queued" };
  } finally {
    deadline.close();
  }
}

export async function checkTwilioReadiness(
  fetchImpl: typeof fetch = fetch,
  {
    signal,
    timeoutMs = 8_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  const config = getTwilioConfig();
  if (
    !config.accountSid ||
    !config.authToken ||
    !config.fromNumber ||
    !config.allowedToNumber
  ) {
    return false;
  }
  const deadline = createProviderDeadline(timeoutMs, signal);
  try {
    const response = await deadline.race(
      fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`,
        {
          method: "GET",
          headers: {
            Authorization: basicAuthentication(
              config.accountSid,
              config.authToken,
            ),
          },
          signal: deadline.signal,
        },
      ),
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    deadline.close();
  }
}
