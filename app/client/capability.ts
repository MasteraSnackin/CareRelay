export type CapabilityAction = "anthropic" | "elevenlabs" | "twilio";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function acquireCapability(
  action: CapabilityAction,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch("/api/providers/capability", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        action === "twilio" ? { action, consent: true } : { action },
      ),
      signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.action !== action ||
      typeof payload.capability !== "string" ||
      payload.capability.length < 16 ||
      typeof payload.expiresInSeconds !== "number" ||
      !Number.isFinite(payload.expiresInSeconds) ||
      payload.expiresInSeconds <= 0
    ) {
      return null;
    }
    return payload.capability;
  } catch {
    return null;
  }
}
