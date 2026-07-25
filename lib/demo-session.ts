export type DemoEvidenceEventType =
  | "document-analysed"
  | "citation-opened"
  | "correct-action-selected"
  | "rehearsal-completed";

export interface DemoEvidenceEvent {
  type: DemoEvidenceEventType;
  at: number;
}

export interface DemoSession {
  startedAt: number;
  lastEventAt: number;
  documentAnalysed: boolean;
  citationsOpened: number;
  correctActionSelected: boolean;
  rehearsalCompleted: boolean;
  timeToFirstCorrectActionMs: number | null;
}

export function createDemoSession(startedAt = 0): DemoSession {
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new Error("A non-negative monotonic start time is required.");
  }
  return {
    startedAt,
    lastEventAt: startedAt,
    documentAnalysed: false,
    citationsOpened: 0,
    correctActionSelected: false,
    rehearsalCompleted: false,
    timeToFirstCorrectActionMs: null,
  };
}

export function recordDemoEvent(
  session: DemoSession,
  event: DemoEvidenceEvent,
): DemoSession {
  if (
    !Number.isFinite(event.at) ||
    event.at < session.startedAt ||
    event.at < session.lastEventAt
  ) {
    return session;
  }

  if (event.type === "document-analysed") {
    if (session.documentAnalysed) return session;
    return {
      ...session,
      documentAnalysed: true,
      lastEventAt: event.at,
    };
  }
  if (event.type === "citation-opened") {
    if (!session.documentAnalysed) return session;
    return {
      ...session,
      citationsOpened: session.citationsOpened + 1,
      lastEventAt: event.at,
    };
  }
  if (event.type === "correct-action-selected") {
    if (
      !session.documentAnalysed ||
      session.citationsOpened < 1 ||
      session.correctActionSelected
    ) {
      return session;
    }
    return {
      ...session,
      correctActionSelected: true,
      timeToFirstCorrectActionMs: event.at - session.startedAt,
      lastEventAt: event.at,
    };
  }
  if (
    !session.correctActionSelected ||
    session.rehearsalCompleted
  ) {
    return session;
  }
  return {
    ...session,
    rehearsalCompleted: true,
    lastEventAt: event.at,
  };
}

export function resetDemoSession(startedAt = 0): DemoSession {
  return createDemoSession(startedAt);
}
