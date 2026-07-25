import { isProductionRuntime } from "./demo-capability";
import { createProviderDeadline } from "./provider-deadline";

export type MeteredAction = "capability" | "anthropic" | "elevenlabs";

interface QuotaPolicy {
  windowMs: number;
  perClient: number;
  global: number;
  concurrency: number;
}

const POLICIES: Record<MeteredAction, QuotaPolicy> = {
  capability: {
    windowMs: 60_000,
    perClient: 20,
    global: 80,
    concurrency: 8,
  },
  anthropic: {
    windowMs: 60_000,
    perClient: 8,
    global: 30,
    concurrency: 2,
  },
  elevenlabs: {
    windowMs: 60_000,
    perClient: 4,
    global: 12,
    concurrency: 2,
  },
};

interface Counter {
  windowStartedAt: number;
  count: number;
}

interface ActionState {
  global: Counter;
  clients: Map<string, Counter>;
  inFlight: number;
}

interface AbuseState {
  actions: Record<MeteredAction, ActionState>;
}

const ABUSE_STORE_SYMBOL = Symbol.for("carerelay.provider-abuse-control");
const COORDINATOR_SYMBOL = Symbol.for(
  "carerelay.provider-abuse-coordinator",
);
export const PROVIDER_COORDINATOR_TIMEOUT_MS = 2_000;

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

function createActionState(): ActionState {
  return {
    global: { windowStartedAt: 0, count: 0 },
    clients: new Map(),
    inFlight: 0,
  };
}

function state(): AbuseState {
  const target = globalThis as typeof globalThis & {
    [ABUSE_STORE_SYMBOL]?: AbuseState;
  };
  target[ABUSE_STORE_SYMBOL] ??= {
    actions: {
      capability: createActionState(),
      anthropic: createActionState(),
      elevenlabs: createActionState(),
    },
  };
  return target[ABUSE_STORE_SYMBOL];
}

function currentCounter(
  counter: Counter | undefined,
  now: number,
  windowMs: number,
): Counter {
  if (
    !counter ||
    (counter.windowStartedAt === 0 && counter.count === 0) ||
    now - counter.windowStartedAt >= windowMs
  ) {
    return { windowStartedAt: now, count: 0 };
  }
  return counter;
}

export interface MeteredPermit {
  ok: true;
  release(): void;
}

export interface MeteredRejection {
  ok: false;
  reason: "client-quota" | "global-quota" | "concurrency";
  retryAfter: number;
}

export type MeteredPermitResult = MeteredPermit | MeteredRejection;

export interface CoordinatedMeteredPermit {
  ok: true;
  release(): Promise<void>;
}

export interface ProviderAbuseCoordinator {
  /**
   * Production adapters must enforce the requested action atomically across
   * all Worker isolates, for example in a Cloudflare Durable Object. Any
   * granted lease must also expire if its caller times out.
   */
  acquire(
    action: MeteredAction,
    clientBinding: string,
    now: number,
  ): Promise<CoordinatedMeteredPermit | MeteredRejection>;
}

export type CoordinatedMeteredPermitResult =
  | CoordinatedMeteredPermit
  | MeteredRejection
  | {
      ok: false;
      reason: "coordination-unavailable";
      retryAfter: number;
    };

function configuredCoordinator(): ProviderAbuseCoordinator | undefined {
  const target = globalThis as typeof globalThis & {
    [COORDINATOR_SYMBOL]?: ProviderAbuseCoordinator;
  };
  return target[COORDINATOR_SYMBOL];
}

export function configureProviderAbuseCoordinator(
  coordinator: ProviderAbuseCoordinator | undefined,
): void {
  const target = globalThis as typeof globalThis & {
    [COORDINATOR_SYMBOL]?: ProviderAbuseCoordinator;
  };
  if (coordinator) {
    target[COORDINATOR_SYMBOL] = coordinator;
  } else {
    delete target[COORDINATOR_SYMBOL];
  }
}

export function acquireMeteredPermit(
  action: MeteredAction,
  clientBinding: string,
  now = Date.now(),
): MeteredPermitResult {
  const policy = POLICIES[action];
  const actionState = state().actions[action];
  for (const [binding, counter] of actionState.clients) {
    if (now - counter.windowStartedAt >= policy.windowMs) {
      actionState.clients.delete(binding);
    }
  }
  actionState.global = currentCounter(
    actionState.global,
    now,
    policy.windowMs,
  );
  const client = currentCounter(
    actionState.clients.get(clientBinding),
    now,
    policy.windowMs,
  );
  actionState.clients.set(clientBinding, client);

  if (client.count >= policy.perClient) {
    return {
      ok: false,
      reason: "client-quota",
      retryAfter: Math.max(
        1,
        Math.ceil(
          (client.windowStartedAt + policy.windowMs - now) / 1_000,
        ),
      ),
    };
  }
  if (actionState.global.count >= policy.global) {
    return {
      ok: false,
      reason: "global-quota",
      retryAfter: Math.max(
        1,
        Math.ceil(
          (actionState.global.windowStartedAt + policy.windowMs - now) /
            1_000,
        ),
      ),
    };
  }
  if (actionState.inFlight >= policy.concurrency) {
    return { ok: false, reason: "concurrency", retryAfter: 1 };
  }

  client.count += 1;
  actionState.global.count += 1;
  actionState.inFlight += 1;
  let active = true;
  return {
    ok: true,
    release() {
      if (!active) return;
      actionState.inFlight = Math.max(0, actionState.inFlight - 1);
      active = false;
    },
  };
}

export async function acquireCoordinatedMeteredPermit(
  action: MeteredAction,
  clientBinding: string,
  now = Date.now(),
  timeoutMs = PROVIDER_COORDINATOR_TIMEOUT_MS,
): Promise<CoordinatedMeteredPermitResult> {
  const coordinator = configuredCoordinator();
  if (coordinator) {
    try {
      const permit = await boundedCoordinatorOperation(
        () => coordinator.acquire(action, clientBinding, now),
        timeoutMs,
      );
      if (!permit.ok) return permit;
      return {
        ok: true,
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
        reason: "coordination-unavailable",
        retryAfter: 60,
      };
    }
  }
  if (isProductionRuntime()) {
    return {
      ok: false,
      reason: "coordination-unavailable",
      retryAfter: 60,
    };
  }
  const permit = acquireMeteredPermit(action, clientBinding, now);
  if (!permit.ok) return permit;
  return {
    ok: true,
    async release() {
      permit.release();
    },
  };
}

export function resetProviderAbuseControl(): void {
  const target = globalThis as typeof globalThis & {
    [ABUSE_STORE_SYMBOL]?: AbuseState;
  };
  delete target[ABUSE_STORE_SYMBOL];
  configureProviderAbuseCoordinator(undefined);
}
