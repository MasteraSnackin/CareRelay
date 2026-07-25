import { isProductionRuntime } from "./demo-capability";
import { createProviderDeadline } from "./provider-deadline";

export const TWILIO_COOLDOWN_MS = 60_000;
export const TWILIO_COORDINATOR_TIMEOUT_MS = 2_000;

interface GuardState {
  inFlight: boolean;
  cooldownUntil: number;
}

const GUARD_SYMBOL = Symbol.for("carerelay.twilio-call-guard");
const COORDINATOR_SYMBOL = Symbol.for("carerelay.twilio-call-coordinator");

async function boundedCoordinatorOperation<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = createProviderDeadline(timeoutMs);
  try {
    return await deadline.race(Promise.resolve().then(operation));
  } finally {
    deadline.close();
  }
}

function guardState(): GuardState {
  const target = globalThis as typeof globalThis & {
    [GUARD_SYMBOL]?: GuardState;
  };
  target[GUARD_SYMBOL] ??= { inFlight: false, cooldownUntil: 0 };
  return target[GUARD_SYMBOL];
}

export interface TwilioCallPermit {
  ok: true;
  queued(now?: number): void;
  release(): void;
}

export interface TwilioCallRejected {
  ok: false;
  retryAfter: number;
  reason: "in-flight" | "cooldown";
}

export type TwilioCallPermitResult = TwilioCallPermit | TwilioCallRejected;

export interface CoordinatedTwilioCallPermit {
  ok: true;
  queued(now?: number): Promise<void>;
  release(): Promise<void>;
}

export interface TwilioCallCoordinator {
  /**
   * A production adapter should implement this as one atomic operation, for
   * example in a Cloudflare Durable Object. Its lease must expire safely if a
   * Worker terminates before queued() or release().
   */
  acquire(now: number): Promise<
    CoordinatedTwilioCallPermit | TwilioCallRejected
  >;
}

export type CoordinatedTwilioCallPermitResult =
  | CoordinatedTwilioCallPermit
  | TwilioCallRejected
  | {
      ok: false;
      retryAfter: number;
      reason: "coordination-unavailable";
    };

function configuredCoordinator(): TwilioCallCoordinator | undefined {
  const target = globalThis as typeof globalThis & {
    [COORDINATOR_SYMBOL]?: TwilioCallCoordinator;
  };
  return target[COORDINATOR_SYMBOL];
}

export function configureTwilioCallCoordinator(
  coordinator: TwilioCallCoordinator | undefined,
): void {
  const target = globalThis as typeof globalThis & {
    [COORDINATOR_SYMBOL]?: TwilioCallCoordinator;
  };
  if (coordinator) {
    target[COORDINATOR_SYMBOL] = coordinator;
  } else {
    delete target[COORDINATOR_SYMBOL];
  }
}

export function acquireTwilioCallPermit(
  now = Date.now(),
): TwilioCallPermitResult {
  const state = guardState();
  if (state.inFlight) {
    return { ok: false, retryAfter: 1, reason: "in-flight" };
  }
  if (now < state.cooldownUntil) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((state.cooldownUntil - now) / 1000)),
      reason: "cooldown",
    };
  }

  state.inFlight = true;
  let active = true;
  return {
    ok: true,
    queued(completedAt = Date.now()) {
      if (!active) return;
      state.cooldownUntil = completedAt + TWILIO_COOLDOWN_MS;
      state.inFlight = false;
      active = false;
    },
    release() {
      if (!active) return;
      state.inFlight = false;
      active = false;
    },
  };
}

export async function acquireCoordinatedTwilioCallPermit(
  now = Date.now(),
  timeoutMs = TWILIO_COORDINATOR_TIMEOUT_MS,
): Promise<CoordinatedTwilioCallPermitResult> {
  const coordinator = configuredCoordinator();
  if (coordinator) {
    try {
      const permit = await boundedCoordinatorOperation(
        () => coordinator.acquire(now),
        timeoutMs,
      );
      if (!permit.ok) return permit;
      return {
        ok: true,
        async queued(completedAt = Date.now()) {
          await boundedCoordinatorOperation(
            () => permit.queued(completedAt),
            timeoutMs,
          );
        },
        async release() {
          await boundedCoordinatorOperation(
            () => permit.release(),
            timeoutMs,
          );
        },
      };
    } catch {
      return {
        ok: false,
        retryAfter: 60,
        reason: "coordination-unavailable",
      };
    }
  }
  if (isProductionRuntime()) {
    return {
      ok: false,
      retryAfter: 60,
      reason: "coordination-unavailable",
    };
  }
  const permit = acquireTwilioCallPermit(now);
  if (!permit.ok) return permit;
  return {
    ok: true,
    async queued(completedAt = Date.now()) {
      permit.queued(completedAt);
    },
    async release() {
      permit.release();
    },
  };
}

export function getTwilioCallGuardState(
  now = Date.now(),
): { inFlight: boolean; cooldownRemainingMs: number } {
  const state = guardState();
  return {
    inFlight: state.inFlight,
    cooldownRemainingMs: Math.max(0, state.cooldownUntil - now),
  };
}

export function resetTwilioCallGuard(): void {
  const state = guardState();
  state.inFlight = false;
  state.cooldownUntil = 0;
  configureTwilioCallCoordinator(undefined);
}
