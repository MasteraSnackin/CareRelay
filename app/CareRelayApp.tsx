"use client";

/* Refs below are read only from event handlers; the view render helpers keep the
 * four client-side views together without changing that lifecycle boundary. */
/* eslint-disable react-hooks/refs */

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FIXTURES,
  getFixture,
  type Fixture,
  type FixtureId,
} from "@/lib/fixtures";
import {
  createDemoSession,
  recordDemoEvent,
  resetDemoSession,
  type DemoSession,
} from "@/lib/demo-session";
import {
  continueRehearsal,
  createRehearsalState,
  endRehearsal as finishRehearsalEarly,
  setRehearsalConsent,
  startRehearsal as beginRehearsal,
  type RehearsalResult,
} from "@/lib/rehearsal";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  MicIcon,
  PhoneIcon,
  QuoteIcon,
  SettingsIcon,
  ShieldIcon,
  UploadIcon,
  VolumeIcon,
} from "./icons";
import {
  GuidedDemoBar,
  type GuidedStep,
} from "./GuidedDemoBar";
import { CallRehearsalPanel } from "./client/CallRehearsalPanel";
import { acquireCapability } from "./client/capability";
import {
  CredentialForm,
  type CredentialState,
  type ProviderId,
} from "./client/CredentialForm";
import { EXPECTED_UPLOAD_STAGE_LABELS } from "./client/document-response";
import { useDocumentUpload } from "./client/useDocumentUpload";
import { useVoiceControls } from "./client/useVoiceControls";

type ViewId = "understand" | "referrals" | "safety" | "settings";
type ExplanationMode = "plain" | "detail" | "cy" | "pl";
type SourceMode = "rendered" | "text";
type AnswerMode = "claude" | "deterministic";
type ProviderState =
  | "not-configured"
  | "configured"
  | "checking"
  | "connected"
  | "failed";

type Citation = {
  id: string;
  page: number;
  passageId: string;
  quote: string;
};

type GroundedAnswer = {
  abstained: boolean;
  answer: string;
  citations: Citation[];
  claims: Array<{ text: string; citationIds: string[] }>;
  mode: AnswerMode;
};

type ProviderUi = {
  liveCallsEnabled: boolean;
  message: string;
  source: string;
  state: ProviderState;
};

const FIXTURE_IDS = Object.keys(FIXTURES) as FixtureId[];
const GUIDED_FIXTURE_ID: FixtureId = "rheumatology";
const RHEUMATOLOGY_FIXTURE = getFixture(GUIDED_FIXTURE_ID);

const NAVIGATION: Array<{
  id: ViewId;
  label: string;
  icon: typeof DocumentIcon;
}> = [
  { id: "understand", label: "Understand a letter", icon: DocumentIcon },
  { id: "referrals", label: "My referrals", icon: FolderIcon },
  { id: "safety", label: "Safety evidence", icon: ShieldIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const GUIDED_STEPS: readonly GuidedStep[] = [
  {
    label: "Reset",
    action: "Reset demonstration",
    description: "Start a clean, in-memory evidence session.",
  },
  {
    label: "Upload synthetic PDF",
    action: "Upload synthetic PDF",
    description: "Load and verify the exact supplied two-page fixture.",
  },
  {
    label: "Clarify",
    action: "Clarify the status",
    description: "Read the plain-English explanation and stated next action.",
  },
  {
    label: "Inspect citation",
    action: "Inspect source citation",
    description: "Open the exact page passage supporting the explanation.",
  },
  {
    label: "Prepare call",
    action: "Prepare the call",
    description: "Review the administrative call script before rehearsing it.",
  },
  {
    label: "Record outcome",
    action: "Complete the four-step rehearsal",
    description: "Consent, complete all four local steps, then record the mock outcome.",
  },
];

const SAFE_ABSTENTION =
  "I cannot answer that from the supplied document. Check the source letter or contact the referral administration team.";

const STATUS_LABEL: Record<FixtureId, string> = {
  rheumatology: "Follow-up due",
  diabetes: "Appointment booked",
  cardiology: "Information needed",
};

const PROVIDERS: Array<{
  env: string[];
  id: ProviderId;
  name: string;
  privacy: string;
  role: string;
}> = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    role: "Optional grounded questions after local deterministic answers.",
    env: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
    privacy:
      "Only the synthetic fixture and the current question are sent after readiness succeeds.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    role: "Optional speech for a small set of server-approved synthetic answers.",
    env: [
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_VOICE_ID",
      "ELEVENLABS_MODEL_ID",
    ],
    privacy:
      "The browser sends an approved speech identifier, never arbitrary answer text.",
  },
  {
    id: "twilio",
    name: "Twilio",
    role: "Optional one-way test call to one fixed, configured destination.",
    env: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
      "TWILIO_ALLOWED_TO_NUMBER",
      "CARERELAY_LIVE_CALLS_ENABLED",
    ],
    privacy:
      "The destination and spoken content are fixed on the server. Calls are not recorded.",
  },
];

const INITIAL_PROVIDER: ProviderUi = {
  liveCallsEnabled: false,
  message: "No readiness check has run.",
  source: "No configuration reported",
  state: "not-configured",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function caseProvenance(fixture: Fixture, verified: boolean): string {
  if (fixture.id === "rheumatology") {
    return verified
      ? "Exact supplied PDF verified"
      : "Bundled example shown before verification";
  }
  return "Bundled preview only";
}

function fixturePassages(fixture: Fixture) {
  return fixture.passages;
}

function pagePassages(fixture: Fixture, page: number) {
  return fixturePassages(fixture).filter((passage) => passage.page === page);
}

function getCitation(fixture: Fixture, passageId: string): Citation | null {
  const passage = fixturePassages(fixture).find(
    (item) => item.id === passageId,
  );
  if (!passage) return null;
  return {
    id: passage.id,
    page: passage.page,
    passageId: passage.id,
    quote: passage.text,
  };
}

function defaultAnswerFor(fixture: Fixture): GroundedAnswer {
  const explanation = fixture.explanations.plain;
  const citationIds = explanation.citationIds.slice(0, 3);
  const citations = citationIds
    .map((id) => getCitation(fixture, id))
    .filter((citation): citation is Citation => citation !== null);
  const answer = explanation.summary;
  return {
    answer,
    citations,
    claims: [
      {
        text: answer,
        citationIds: citations.map((citation) => citation.id),
      },
    ],
    abstained: false,
    mode: "deterministic",
  };
}

function normaliseAnswer(value: unknown): GroundedAnswer | null {
  const source =
    isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(source)) return null;
  const answer = readString(source.answer);
  const rawCitations = Array.isArray(source.citations)
    ? source.citations
    : [];
  const citations = rawCitations
    .map((item): Citation | null => {
      if (!isRecord(item)) return null;
      const id = readString(item.id);
      const passageId = readString(item.passageId);
      const quote = readString(item.quote);
      const page = readNumber(item.page);
      if (!id || !passageId || !quote || page < 1) return null;
      return { id, page, passageId, quote };
    })
    .filter((item): item is Citation => item !== null);
  const rawClaims = Array.isArray(source.claims) ? source.claims : [];
  const claims = rawClaims
    .map((item): { text: string; citationIds: string[] } | null => {
      if (!isRecord(item)) return null;
      const text = readString(item.text);
      const citationIds = Array.isArray(item.citationIds)
        ? item.citationIds.filter(
            (citationId): citationId is string =>
              typeof citationId === "string",
          )
        : [];
      if (!text) return null;
      return { text, citationIds };
    })
    .filter(
      (item): item is { text: string; citationIds: string[] } =>
        item !== null,
    );
  const abstained = source.abstained === true;
  if (!answer) return null;
  if (!abstained && (citations.length === 0 || claims.length === 0)) return null;
  return {
    answer,
    citations,
    claims,
    abstained,
    mode: source.mode === "claude" ? "claude" : "deterministic",
  };
}

function normaliseProviderState(value: unknown): ProviderState {
  const raw = readString(value).toLowerCase().replaceAll("_", "-");
  if (raw === "not-configured") return "not-configured";
  if (raw.includes("connected") || raw === "ready") return "connected";
  if (raw.includes("checking")) return "checking";
  if (raw.includes("failed") || raw.includes("error")) return "failed";
  if (raw.includes("configured")) return "configured";
  return "not-configured";
}

function statusText(state: ProviderState): string {
  switch (state) {
    case "configured":
      return "Configured — not tested";
    case "checking":
      return "Checking…";
    case "connected":
      return "Connected";
    case "failed":
      return "Connection failed";
    default:
      return "Not configured";
  }
}

function nowMonotonic(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function Logo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <span className="brand-sheet brand-sheet-one" />
      <span className="brand-sheet brand-sheet-two" />
      <span className="brand-dot" />
    </span>
  );
}

export default function CareRelayApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCardRef = useRef<HTMLElement>(null);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const sourceCardRef = useRef<HTMLElement>(null);
  const explanationRef = useRef<HTMLElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const callPanelRef = useRef<HTMLElement>(null);
  const pageTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const caseRadioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstViewRender = useRef(true);
  const questionLock = useRef(false);
  const requestSequence = useRef(0);
  const questionController = useRef<AbortController | null>(null);

  const [view, setView] = useState<ViewId>("understand");
  const [fixtureId, setFixtureId] = useState<FixtureId>("rheumatology");
  const [explanationMode, setExplanationMode] =
    useState<ExplanationMode>("plain");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [activePage, setActivePage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(
    null,
  );
  const [selectionMessage, setSelectionMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer>(() =>
    defaultAnswerFor(getFixture("rheumatology")),
  );
  const [questionState, setQuestionState] = useState<
    "idle" | "checking" | "error"
  >("idle");
  const [questionMessage, setQuestionMessage] = useState(
    "Local answer checked against the bundled example.",
  );
  const [voiceOutputAllowed, setVoiceOutputAllowed] = useState(true);
  const [verified, setVerified] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [guidedActive, setGuidedActive] = useState(true);
  const [guidedStep, setGuidedStep] = useState(0);
  const [guidedConfirmed, setGuidedConfirmed] = useState<boolean[]>(
    () => GUIDED_STEPS.map(() => false),
  );
  const [evidence, setEvidence] = useState<DemoSession>(() =>
    createDemoSession(nowMonotonic()),
  );
  const [rehearsal, setRehearsal] = useState(() =>
    createRehearsalState(GUIDED_FIXTURE_ID),
  );
  const [callSeconds, setCallSeconds] = useState(0);
  const [callMessage, setCallMessage] = useState("");
  const [rehearsalResults, setRehearsalResults] = useState<
    Partial<Record<FixtureId, RehearsalResult>>
  >({});
  const [liveConsent, setLiveConsent] = useState(false);
  const [liveCallState, setLiveCallState] = useState<
    "idle" | "sending" | "queued" | "error"
  >("idle");
  const [liveCallMessage, setLiveCallMessage] = useState("");
  const [providerUi, setProviderUi] = useState<Record<ProviderId, ProviderUi>>({
    anthropic: { ...INITIAL_PROVIDER },
    elevenlabs: { ...INITIAL_PROVIDER },
    twilio: { ...INITIAL_PROVIDER },
  });
  const [providerMessage, setProviderMessage] = useState("");
  const [expandedProvider, setExpandedProvider] =
    useState<ProviderId | null>("anthropic");
  const [loopbackHost, setLoopbackHost] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [credentials, setCredentials] = useState<CredentialState>({
    anthropicKey: "",
    elevenlabsKey: "",
    elevenlabsVoiceId: "",
    elevenlabsModelId: "",
    twilioAccountSid: "",
    twilioAuthToken: "",
    twilioFromNumber: "",
    twilioAllowedNumber: "",
    twilioEnabled: false,
  });
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);

  const fixture = getFixture(fixtureId);
  const explanation = fixture.explanations[explanationMode];
  const sourceVerified = verified && fixtureId === "rheumatology";

  const confirmGuided = useCallback(
    (index: number, eventFixtureId: FixtureId) => {
      if (eventFixtureId !== GUIDED_FIXTURE_ID) return;
      setGuidedConfirmed((current) => {
        if (index > 0 && !current.slice(0, index).every(Boolean)) return current;
        if (current[index]) return current;
        const next = [...current];
        next[index] = true;
        return next;
      });
    },
    [],
  );

  const captureTranscript = useCallback((transcript: string) => {
    setQuestion(transcript);
  }, []);

  const focusQuestionInput = useCallback(() => {
    questionInputRef.current?.focus();
  }, []);

  const {
    cancelVoice,
    isListening,
    listenToAnswer,
    message: voiceMessage,
    startVoiceInput,
  } = useVoiceControls({
    allowed: voiceOutputAllowed,
    answerLanguage: "en-GB",
    answerText: answer.answer,
    elevenLabsReady: providerUi.elevenlabs.state === "connected",
    fixtureId,
    onTranscript: captureTranscript,
    onUnsupported: focusQuestionInput,
  });

  const activateCase = useCallback(
    (nextId: FixtureId, verifiedOverride = verified) => {
      requestSequence.current += 1;
      questionController.current?.abort();
      questionLock.current = false;
      cancelVoice();
      const nextFixture = getFixture(nextId);
      setFixtureId(nextId);
      setExplanationMode("plain");
      setActivePage(1);
      setActiveCitation(null);
      setSelectedText("");
      setSelectedPassageId(null);
      setSelectionMessage("");
      setQuestion("");
      setAnswer(defaultAnswerFor(nextFixture));
      setQuestionState("idle");
      setQuestionMessage(
        nextId === GUIDED_FIXTURE_ID && verifiedOverride
          ? "Local answer verified against the uploaded PDF."
          : "Local answer checked against the bundled example.",
      );
      setSourceMode(
        nextId === GUIDED_FIXTURE_ID && verifiedOverride
          ? "rendered"
          : "text",
      );
      setRehearsal(createRehearsalState(nextId));
      setCallSeconds(0);
      setCallMessage("");
      setLiveConsent(false);
      setLiveCallState("idle");
      setLiveCallMessage("");
    },
    [cancelVoice, verified],
  );

  const handleDocumentBegin = useCallback(() => {
    setVerified(false);
  }, []);

  const handleDocumentRejected = useCallback(() => {
    setVerified(false);
  }, []);

  const handleDocumentVerified = useCallback(() => {
    setVerified(true);
    activateCase(GUIDED_FIXTURE_ID, true);
    setSourceMode("rendered");
    setQuestionMessage("Local answer verified against the uploaded PDF.");
    setEvidence((current) =>
      recordDemoEvent(current, {
        type: "document-analysed",
        at: nowMonotonic(),
      }),
    );
    confirmGuided(1, GUIDED_FIXTURE_ID);
  }, [activateCase, confirmGuided]);

  const {
    busy: uploadBusy,
    cancelPending: cancelPendingUpload,
    citations: uploadCitations,
    loadBundledPdf: loadDemoPdf,
    message: uploadMessage,
    resetUpload,
    stages: uploadStages,
    state: uploadState,
    uploadFile: handleUpload,
  } = useDocumentUpload({
    fixture: RHEUMATOLOGY_FIXTURE,
    onBegin: handleDocumentBegin,
    onRejected: handleDocumentRejected,
    onVerified: handleDocumentVerified,
  });

  const verifySuppliedPdf = useCallback(() => {
    uploadCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    void loadDemoPdf();
  }, [loadDemoPdf]);

  const resetSession = useCallback(() => {
    resetUpload();
    activateCase(GUIDED_FIXTURE_ID, false);
    requestSequence.current += 1;
    questionController.current?.abort();
    questionLock.current = false;
    setVerified(false);
    setRehearsalResults({});
    setEvidence(resetDemoSession(nowMonotonic()));
    setGuidedStep(0);
    setGuidedConfirmed(() => {
      const state = GUIDED_STEPS.map(() => false);
      state[0] = true;
      return state;
    });
    setGuidedActive(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [activateCase, resetUpload]);

  const navigate = useCallback((nextView: ViewId) => {
    setView(nextView);
  }, []);

  useEffect(() => {
    if (firstViewRender.current) {
      firstViewRender.current = false;
      return;
    }
    window.requestAnimationFrame(() => viewHeadingRef.current?.focus());
  }, [view]);

  useEffect(() => {
    if (rehearsal.status !== "active") return;
    const timer = window.setInterval(() => {
      setCallSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rehearsal.status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hostname = window.location.hostname;
      setLoopbackHost(
        hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "::1" ||
          hostname === "[::1]",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const ingestProviderPayload = useCallback((payload: unknown) => {
    if (!isRecord(payload)) return;
    const rawProviders = Array.isArray(payload.providers)
      ? payload.providers
      : isRecord(payload.provider)
        ? [payload.provider]
        : isRecord(payload.providers)
          ? Object.entries(payload.providers).map(([provider, value]) =>
              isRecord(value) ? { provider, ...value } : value,
            )
          : PROVIDERS.map(({ id }) => {
              const value = payload[id];
              return isRecord(value) ? { provider: id, ...value } : null;
            }).filter((value) => value !== null);
    setProviderUi((current) => {
      const next = { ...current };
      for (const raw of rawProviders) {
        if (!isRecord(raw)) continue;
        const providerId = readString(raw.provider);
        if (
          providerId !== "anthropic" &&
          providerId !== "elevenlabs" &&
          providerId !== "twilio"
        ) {
          continue;
        }
        const state = normaliseProviderState(
          raw.state ?? raw.status ?? raw.readiness,
        );
        next[providerId] = {
          state,
          liveCallsEnabled: raw.liveCallsEnabled === true,
          source: readString(
            raw.source ?? raw.configurationSource,
            state === "not-configured"
              ? "No configuration reported"
              : "Server configuration",
          ),
          message: readString(
            raw.message,
            state === "connected"
              ? "Readiness check succeeded."
              : statusText(state),
          ),
        };
      }
      return next;
    });
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/status", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json();
      if (response.ok) ingestProviderPayload(payload);
    } catch {
      setProviderMessage(
        "Provider status is unavailable. Local grounded mode remains available.",
      );
    }
  }, [ingestProviderPayload]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshProviders(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshProviders]);

  const selectCase = useCallback(
    (nextId: FixtureId) => {
      if (nextId === fixtureId) return;
      cancelPendingUpload("Document check cancelled after the case changed.");
      activateCase(nextId);
      if (nextId !== GUIDED_FIXTURE_ID) setGuidedActive(false);
    },
    [activateCase, cancelPendingUpload, fixtureId],
  );

  const openCitation = useCallback(
    (citation: Citation | string) => {
      const passageId =
        typeof citation === "string" ? citation : citation.passageId;
      const passage = fixturePassages(fixture).find(
        (item) => item.id === passageId,
      );
      if (!passage) {
        setQuestionMessage(
          "That citation is not present in this fixture. No substitute was opened.",
        );
        return;
      }
      setActiveCitation(passage.id);
      setActivePage(passage.page);
      if (sourceVerified) {
        setEvidence((current) =>
          recordDemoEvent(current, {
            type: "citation-opened",
            at: nowMonotonic(),
          }),
        );
      }
      confirmGuided(3, fixture.id);
      window.requestAnimationFrame(() => {
        sourceCardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        window.requestAnimationFrame(() => {
          const element = document.querySelector<HTMLElement>(
            `[data-passage-id="${CSS.escape(passage.id)}"]`,
          );
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });
    },
    [confirmGuided, fixture, sourceVerified],
  );

  const onSourceSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!selection || selection.rangeCount === 0 || !text) return;
    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const startPassage = startElement?.closest<HTMLElement>(
      "[data-passage-id]",
    );
    const endPassage = endElement?.closest<HTMLElement>("[data-passage-id]");
    const passageId = startPassage?.dataset.passageId;
    const knownPassage = fixturePassages(fixture).find(
      (item) => item.id === passageId,
    );
    if (
      text.length < 3 ||
      text.length > 500 ||
      !passageId ||
      startPassage !== endPassage ||
      !knownPassage ||
      !knownPassage.text.includes(text)
    ) {
      setSelectedText("");
      setSelectedPassageId(null);
      setSelectionMessage(
        "Select 3–500 characters entirely within one source passage.",
      );
      return;
    }
    setSelectedText(text);
    setSelectedPassageId(passageId);
    setSelectionMessage("Source passage selected.");
  }, [fixture]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setSelectedPassageId(null);
    setSelectionMessage("Selection cleared.");
  }, []);

  const explainSelection = useCallback(() => {
    setExplanationMode("plain");
    setSelectionMessage(
      "Plain-English explanation selected. The source passage remains attached.",
    );
    explanationRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    confirmGuided(2, fixtureId);
  }, [confirmGuided, fixtureId]);

  const translateSelection = useCallback(() => {
    setExplanationMode("cy");
    setSelectionMessage(
      "Welsh demonstration translation selected. It is not professionally reviewed.",
    );
    explanationRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const askAboutSelection = useCallback(() => {
    setQuestion(selectedText);
    setSelectionMessage(
      "The selected passage is in the question field. Review it before sending.",
    );
    window.requestAnimationFrame(() => questionInputRef.current?.focus());
  }, [selectedText]);

  const submitQuestion = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const trimmed = question.trim();
      if (questionLock.current || questionState === "checking") {
        setQuestionMessage(
          "A source check is already in progress. Please wait for it to finish.",
        );
        return;
      }
      if (trimmed.length < 2 || trimmed.length > 1000) {
        setQuestionState("error");
        setQuestionMessage(
          "Enter a question between 2 and 1,000 characters. The previous checked answer has been kept.",
        );
        return;
      }
      const sequence = ++requestSequence.current;
      questionLock.current = true;
      questionController.current?.abort();
      const controller = new AbortController();
      questionController.current = controller;
      setQuestionState("checking");
      setQuestionMessage("Checking the synthetic source…");
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const capability =
          providerUi.anthropic.state === "connected"
            ? await acquireCapability("anthropic", controller.signal)
            : null;
        if (sequence !== requestSequence.current) return;
        const response = await fetch("/api/analyse", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(capability
              ? { "X-CareRelay-Capability": capability }
              : {}),
          },
          body: JSON.stringify({
            documentId: fixtureId,
            question: trimmed,
            ...(selectedText ? { selectedText } : {}),
          }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (sequence !== requestSequence.current) return;
        if (!response.ok) {
          throw new Error("The source check did not complete.");
        }
        const checked = normaliseAnswer(payload);
        if (!checked) {
          throw new Error("The returned answer did not pass citation checks.");
        }
        cancelVoice();
        setAnswer(checked);
        setQuestionState("idle");
        setQuestionMessage(
          checked.abstained
            ? "Source boundary: the document does not support that answer."
            : checked.mode === "claude"
              ? "Provider-selected local answer verified against exact source citations."
              : "Local answer verified against exact source citations.",
        );
      } catch (error) {
        if (sequence !== requestSequence.current) return;
        setQuestionState("error");
        setQuestionMessage(
          error instanceof DOMException && error.name === "AbortError"
            ? "The source check timed out. The previous checked answer has been kept."
            : "The source check failed. The previous checked answer has been kept.",
        );
      } finally {
        window.clearTimeout(timeout);
        if (sequence === requestSequence.current) {
          questionLock.current = false;
          setQuestionState((state) => (state === "checking" ? "idle" : state));
        }
      }
    },
    [
      fixtureId,
      cancelVoice,
      providerUi.anthropic.state,
      question,
      questionState,
      selectedText,
    ],
  );

  const chooseSuggestedQuestion = useCallback((suggestion: string) => {
    setQuestion(suggestion);
    window.requestAnimationFrame(() => questionInputRef.current?.focus());
  }, []);

  const prepareCall = useCallback(() => {
    if (fixtureId === GUIDED_FIXTURE_ID) {
      setEvidence((current) =>
        recordDemoEvent(current, {
          type: "correct-action-selected",
          at: nowMonotonic(),
        }),
      );
    }
    confirmGuided(4, fixtureId);
    setCallMessage(
      "The documented administrative action is ready to rehearse. Consent is still required.",
    );
    callPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [confirmGuided, fixtureId]);

  const startRehearsal = useCallback(() => {
    const next = beginRehearsal(rehearsal);
    if (next === rehearsal) {
      setCallMessage(
        "Confirm the synthetic-data consent before starting the local rehearsal.",
      );
      return;
    }
    setRehearsal(next);
    setCallSeconds(0);
    setCallMessage(
      "Controlled local rehearsal started. No call has been placed or recorded.",
    );
  }, [rehearsal]);

  const updateRehearsalConsent = useCallback((consent: boolean) => {
    setRehearsal((current) => setRehearsalConsent(current, consent));
  }, []);

  const advanceRehearsal = useCallback(() => {
    const next = continueRehearsal(rehearsal, fixture);
    setRehearsal(next);
    if (next.status === "completed" && next.result) {
      setRehearsalResults((current) => ({
        ...current,
        [fixtureId]: next.result,
      }));
      if (fixtureId === GUIDED_FIXTURE_ID) {
        setEvidence((current) =>
          recordDemoEvent(current, {
            type: "rehearsal-completed",
            at: nowMonotonic(),
          }),
        );
      }
      setCallMessage(
        "Simulated outcome recorded. No external call was placed.",
      );
      confirmGuided(5, fixtureId);
    }
  }, [confirmGuided, fixture, fixtureId, rehearsal]);

  const endRehearsal = useCallback(() => {
    setRehearsal((current) => finishRehearsalEarly(current));
    setCallSeconds(0);
    setCallMessage(
      "Rehearsal ended early. Nothing was recorded and no external call was placed.",
    );
  }, []);

  const queueLiveCall = useCallback(async () => {
    if (
      !liveConsent ||
      providerUi.twilio.state !== "connected" ||
      !providerUi.twilio.liveCallsEnabled
    ) {
      return;
    }
    setLiveCallState("sending");
    setLiveCallMessage("Requesting one fixed controlled test call…");
    try {
      const capability = await acquireCapability("twilio");
      if (!capability) {
        throw new Error(
          "The one-use call permission was unavailable. No call was requested.",
        );
      }
      const response = await fetch("/api/calls/mock", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CareRelay-Capability": capability,
        },
        body: JSON.stringify({ consent: true }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const wait = response.headers.get("retry-after");
        throw new Error(
          response.status === 429 && wait
            ? `The controlled call is cooling down. Try again after ${wait} seconds.`
            : "The controlled call was not queued.",
        );
      }
      const source =
        isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
      if (!isRecord(source) || source.status !== "queued") {
        throw new Error("The provider did not confirm a queued request.");
      }
      setLiveCallState("queued");
      setLiveCallMessage(
        "The fixed controlled test call was queued. This does not mean it rang, was answered or completed.",
      );
      setLiveConsent(false);
    } catch (error) {
      setLiveCallState("error");
      setLiveCallMessage(
        error instanceof Error
          ? error.message
          : "The controlled call was not queued.",
      );
    }
  }, [
    liveConsent,
    providerUi.twilio.liveCallsEnabled,
    providerUi.twilio.state,
  ]);

  const runProviderCheck = useCallback(async (provider: ProviderId) => {
    setProviderUi((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        state: "checking",
        message: "Readiness check in progress.",
      },
    }));
    setProviderMessage(`Checking ${provider} readiness…`);
    try {
      const response = await fetch("/api/providers/check", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error();
      ingestProviderPayload(payload);
      setProviderMessage(`${provider} readiness check finished.`);
    } catch {
      setProviderUi((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          state: "failed",
          message: "The readiness check failed. Local mode is unaffected.",
        },
      }));
      setProviderMessage(
        `${provider} connection failed. Local grounded mode remains available.`,
      );
    }
  }, [ingestProviderPayload]);

  const providerCredentialPayload = useCallback(
    (provider: ProviderId): Record<string, unknown> => {
      if (provider === "anthropic") {
        return { apiKey: credentials.anthropicKey };
      }
      if (provider === "elevenlabs") {
        return {
          apiKey: credentials.elevenlabsKey,
          voiceId: credentials.elevenlabsVoiceId,
          modelId: credentials.elevenlabsModelId || undefined,
        };
      }
      return {
        accountSid: credentials.twilioAccountSid,
        authToken: credentials.twilioAuthToken,
        fromNumber: credentials.twilioFromNumber,
        allowedToNumber: credentials.twilioAllowedNumber,
        liveCallsEnabled: credentials.twilioEnabled,
      };
    },
    [credentials],
  );

  const clearCredentialForm = useCallback((provider: ProviderId) => {
    setCredentials((current) => {
      if (provider === "anthropic") {
        return { ...current, anthropicKey: "" };
      }
      if (provider === "elevenlabs") {
        return {
          ...current,
          elevenlabsKey: "",
          elevenlabsVoiceId: "",
          elevenlabsModelId: "",
        };
      }
      return {
        ...current,
        twilioAccountSid: "",
        twilioAuthToken: "",
        twilioFromNumber: "",
        twilioAllowedNumber: "",
        twilioEnabled: false,
      };
    });
  }, []);

  const saveCredentials = useCallback(
    async (provider: ProviderId, event: FormEvent) => {
      event.preventDefault();
      if (!loopbackHost) {
        setProviderMessage(
          "Temporary credential entry is disabled on public hosts.",
        );
        return;
      }
      setSavingProvider(provider);
      setProviderMessage(`Saving temporary ${provider} configuration…`);
      try {
        const response = await fetch("/api/settings/secrets", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            provider,
            values: providerCredentialPayload(provider),
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error();
        clearCredentialForm(provider);
        setProviderMessage(
          `Temporary ${provider} configuration saved in server-process memory. Form values were cleared.`,
        );
        ingestProviderPayload(payload);
        await refreshProviders();
      } catch {
        setProviderMessage(
          `Temporary ${provider} configuration was not saved. Form values remain available for correction.`,
        );
      } finally {
        setSavingProvider(null);
      }
    },
    [
      clearCredentialForm,
      ingestProviderPayload,
      loopbackHost,
      providerCredentialPayload,
      refreshProviders,
    ],
  );

  const clearCredentials = useCallback(
    async (provider: ProviderId) => {
      if (!loopbackHost) return;
      setSavingProvider(provider);
      setProviderMessage(`Clearing temporary ${provider} configuration…`);
      try {
        const response = await fetch("/api/settings/secrets", {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ provider }),
        });
        if (!response.ok) throw new Error();
        clearCredentialForm(provider);
        setProviderMessage(
          `Temporary ${provider} values cleared. Unchanged environment configuration is now visible.`,
        );
        await refreshProviders();
      } catch {
        setProviderMessage(`Temporary ${provider} values could not be cleared.`);
      } finally {
        setSavingProvider(null);
      }
    },
    [clearCredentialForm, loopbackHost, refreshProviders],
  );

  const handleGuidedAction = useCallback(() => {
    switch (guidedStep) {
      case 0:
        resetSession();
        break;
      case 1:
        void loadDemoPdf();
        break;
      case 2:
        setExplanationMode("plain");
        explanationRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        confirmGuided(2, fixtureId);
        break;
      case 3: {
        const firstCitation = fixture.explanations.plain.citationIds[0];
        if (firstCitation) openCitation(firstCitation);
        break;
      }
      case 4:
        prepareCall();
        break;
      case 5:
        callPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        setCallMessage(
          "Complete all four local rehearsal steps below. Consent cannot be assumed.",
        );
        break;
    }
  }, [
    confirmGuided,
    fixture.explanations.plain.citationIds,
    fixtureId,
    guidedStep,
    openCitation,
    prepareCall,
    resetSession,
    loadDemoPdf,
  ]);

  const handleGuidedNext = useCallback(() => {
    if (!guidedConfirmed[guidedStep]) return;
    if (guidedStep === GUIDED_STEPS.length - 1) {
      setGuidedActive(false);
      navigate("referrals");
      return;
    }
    setGuidedStep((step) => step + 1);
  }, [guidedConfirmed, guidedStep, navigate]);

  const resumeGuidedDemo = useCallback(() => {
    if (fixtureId !== GUIDED_FIXTURE_ID) selectCase(GUIDED_FIXTURE_ID);
    setGuidedActive(true);
    navigate("understand");
  }, [fixtureId, navigate, selectCase]);

  const handleCaseRadioKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % FIXTURE_IDS.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + FIXTURE_IDS.length) % FIXTURE_IDS.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = FIXTURE_IDS.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const nextId = FIXTURE_IDS[nextIndex];
      if (nextId) selectCase(nextId);
      caseRadioRefs.current[nextIndex]?.focus();
    },
    [selectCase],
  );

  const setPageFromTab = useCallback((page: number) => {
    setActivePage(page);
    setActiveCitation(null);
  }, []);

  const handleTabKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (event.key === "ArrowRight") {
        nextIndex = (index + 1) % fixture.pages.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + fixture.pages.length) % fixture.pages.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = fixture.pages.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const page = fixture.pages[nextIndex]?.page;
      if (page) setPageFromTab(page);
      pageTabRefs.current[nextIndex]?.focus();
    },
    [fixture.pages, setPageFromTab],
  );

  const explanationCitations = useMemo(
    () =>
      explanation.citationIds
        .map((id) => getCitation(fixture, id))
        .filter((citation): citation is Citation => citation !== null),
    [explanation.citationIds, fixture],
  );

  const renderViewHeading = (
    title: string,
    supporting: string,
    boundary?: string,
    primaryAction?: {
      disabled: boolean;
      label: string;
      note: string;
      onClick: () => void;
    },
  ) => (
    <header className="page-heading">
      <div>
        <h1 ref={viewHeadingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{supporting}</p>
      </div>
      {boundary || primaryAction ? (
        <div className="page-heading-aside">
          {boundary ? (
            <span className="boundary-pill">
              <ShieldIcon size={17} />
              {boundary}
            </span>
          ) : null}
          {primaryAction ? (
            <div className="primary-workflow-action">
              <button
                className="button button-primary"
                disabled={primaryAction.disabled}
                type="button"
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
                {!primaryAction.disabled ? <ArrowRightIcon size={17} /> : null}
              </button>
              <small>{primaryAction.note}</small>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );

  const renderUnderstand = () => (
    <div className="view-stack">
      {renderViewHeading(
        "Know what your letter means — and what to do next.",
        "CareRelay turns difficult referral administration into a clear, cited action plan. Every claim stays connected to the source.",
        "Independent · not medical advice",
        {
          disabled: uploadBusy || sourceVerified,
          label:
            uploadState === "analysing"
              ? "Verifying supplied PDF…"
              : sourceVerified
                ? "Supplied PDF verified"
                : "Verify supplied PDF",
          note: "Uses the bundled rheumatology fixture.",
          onClick: verifySuppliedPdf,
        },
      )}

      <section className="case-selector" aria-labelledby="case-selector-title">
        <div className="section-label-row">
          <div>
            <p className="kicker">Choose a synthetic case</p>
            <h2 id="case-selector-title">Referral examples</h2>
          </div>
          <span className="case-count">3 bounded fixtures</span>
        </div>
        <div className="case-options" role="radiogroup" aria-label="Synthetic case">
          {FIXTURE_IDS.map((id, index) => {
            const item = getFixture(id);
            const active = fixtureId === id;
            return (
              <button
                aria-checked={active}
                className={`case-option ${active ? "case-option-active" : ""}`}
                key={id}
                ref={(element) => {
                  caseRadioRefs.current[index] = element;
                }}
                role="radio"
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => selectCase(id)}
                onKeyDown={(event) => handleCaseRadioKey(event, index)}
              >
                <span className="case-option-top">
                  <strong>{item.department}</strong>
                  <span className={`status-pill status-${item.statusTone}`}>
                    {STATUS_LABEL[id]}
                  </span>
                </span>
                <span className="case-reference">
                  {item.reference}
                  {item.previewOnly ? " · preview" : ""}
                </span>
                <small>{caseProvenance(item, verified)}</small>
              </button>
            );
          })}
        </div>
      </section>

      <GuidedDemoBar
        active={guidedActive}
        confirmed={guidedConfirmed}
        currentStep={guidedStep}
        steps={GUIDED_STEPS}
        onAction={handleGuidedAction}
        onExit={() => setGuidedActive(false)}
        onNext={handleGuidedNext}
        onResume={resumeGuidedDemo}
      />

      <section
        aria-busy={uploadBusy}
        className="card upload-card"
        ref={uploadCardRef}
        aria-labelledby="upload-title"
      >
        <div className="upload-intro">
          <p className="kicker">1 · Upload your document</p>
          <h2 id="upload-title">Verify the supplied synthetic PDF</h2>
          <p>
            A bundled fixture preview is visible below. Load its exact PDF to
            prove the parser, safety checks and citation mapping; altered or
            unrecognised files are rejected.
          </p>
          <ul className="boundary-list" aria-label="Upload boundaries">
            <li>No file storage</li>
            <li>Synthetic fixture only</li>
            <li>PDF · 4 MB maximum · 6 pages maximum</li>
          </ul>
        </div>
        <div
          className={`dropzone ${isDragging ? "dropzone-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (uploadState !== "analysing") setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void handleUpload(file);
          }}
        >
          <span className="dropzone-icon">
            <UploadIcon size={25} />
          </span>
          <strong>Drag and drop the supplied PDF</strong>
          <span>Only the exact CareRelay fixture can be verified.</span>
          <input
            accept=".pdf,application/pdf"
            disabled={uploadBusy}
            hidden
            ref={fileInputRef}
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUpload(file).finally(() => {
                  if (fileInputRef.current) fileInputRef.current.value = "";
                });
              }
            }}
          />
          <div className="dropzone-actions">
            <button
              className="button button-primary"
              disabled={uploadBusy}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose PDF
            </button>
            <button
              className="button button-secondary"
              disabled={uploadBusy}
              type="button"
              onClick={() => void loadDemoPdf()}
            >
              Use synthetic demo PDF
            </button>
          </div>
          <a
            className="text-link"
            download
            href="/demo/rheumatology-referral-synthetic.pdf"
          >
            <DownloadIcon size={17} />
            Download the exact test PDF
          </a>
        </div>
        <div className="analysis-evidence">
          <div className={`upload-state upload-state-${uploadState}`}>
            {uploadState === "analysing" ? (
              <span className="spinner" aria-hidden="true" />
            ) : uploadState === "ready" ? (
              <CheckIcon size={19} />
            ) : (
              <DocumentIcon size={19} />
            )}
            <span>
              <strong>
                {uploadState === "idle"
                  ? "Ready for a synthetic document"
                  : uploadState === "analysing"
                    ? "Analysis in progress"
                    : uploadState === "ready"
                      ? "Analysis verified"
                      : "Document not accepted"}
              </strong>
              <small>{uploadMessage}</small>
            </span>
          </div>
          <ol className="analysis-stages">
            {EXPECTED_UPLOAD_STAGE_LABELS.map((stage, index) => {
              const complete =
                uploadState === "ready" &&
                (uploadStages[index] === stage ||
                  uploadStages.includes(stage) ||
                  uploadStages.length === 6);
              return (
                <li className={complete ? "stage-complete" : ""} key={stage}>
                  <span aria-hidden="true">
                    {complete ? <CheckIcon size={14} /> : index + 1}
                  </span>
                  {stage}
                </li>
              );
            })}
          </ol>
          {uploadState === "ready" ? (
            <p className="privacy-note">
              Storage: none · Retention: this request only
            </p>
          ) : null}
        </div>
        <p className="visually-hidden" aria-live="polite" role="status">
          {uploadMessage}
        </p>
      </section>

      <section className="journey-section" aria-labelledby="journey-title">
        <div className="section-label-row">
          <div>
            <p className="kicker">Evidence chain</p>
            <h2 id="journey-title">From source to grounded action</h2>
          </div>
          <span
            className={`provenance-banner ${
              sourceVerified ? "provenance-verified" : ""
            }`}
          >
            {sourceVerified ? <CheckIcon size={17} /> : <InfoIcon size={17} />}
            {sourceVerified
              ? "Exact PDF verified"
              : "Bundled example result"}
          </span>
        </div>
        <ol className="journey-grid">
          {[
            ["Upload your document", "Drag and drop"],
            ["System verifies content", "Known fixture checks"],
            ["Get a simple explanation", "Plain and cited"],
            ["Ask specific questions", "Grounded answers"],
          ].map(([label, detail], index) => {
            const complete = sourceVerified && index < 3;
            const current = sourceVerified ? index === 3 : index === 0;
            return (
              <li
                className={`${complete ? "journey-complete" : ""} ${
                  current ? "journey-current" : ""
                }`}
                key={label}
              >
                <span>{complete ? <CheckIcon size={15} /> : index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="workspace-grid" aria-label="Source and explanation">
        <article
          className="card source-card"
          ref={sourceCardRef}
          aria-labelledby="source-title"
        >
          <div className="card-heading">
            <div>
              <p className="kicker">
                {sourceVerified
                  ? "Verified PDF source"
                  : "Bundled example source"}
              </p>
              <h2 id="source-title">{fixture.title}</h2>
            </div>
            <span className="page-count">2 pages</span>
          </div>
          <div className="source-toolbar">
            <div
              aria-label="Source pages"
              className="tabs"
              role="tablist"
            >
              {fixture.pages.map((page, index) => (
                <button
                  aria-controls={`source-page-${page.page}`}
                  aria-selected={activePage === page.page}
                  className="tab"
                  id={`source-tab-${page.page}`}
                  key={page.page}
                  ref={(element) => {
                    pageTabRefs.current[index] = element;
                  }}
                  role="tab"
                  tabIndex={activePage === page.page ? 0 : -1}
                  type="button"
                  onClick={() => setPageFromTab(page.page)}
                  onKeyDown={(event) => handleTabKey(event, index)}
                >
                  Page {page.page}
                </button>
              ))}
            </div>
            {sourceVerified ? (
              <div className="segmented compact-segmented" aria-label="Source format">
                <button
                  aria-pressed={sourceMode === "rendered"}
                  type="button"
                  onClick={() => setSourceMode("rendered")}
                >
                  Rendered PDF
                </button>
                <button
                  aria-pressed={sourceMode === "text"}
                  type="button"
                  onClick={() => setSourceMode("text")}
                >
                  Accessible text
                </button>
              </div>
            ) : (
              <span className="source-format">Accessible synthetic text</span>
            )}
          </div>

          {fixture.pages
            .filter((page) => page.page !== activePage)
            .map((page) => (
              <div
                aria-labelledby={`source-tab-${page.page}`}
                hidden
                id={`source-page-${page.page}`}
                key={page.page}
                role="tabpanel"
              />
            ))}
          <div
            aria-labelledby={`source-tab-${activePage}`}
            className="source-page-panel"
            id={`source-page-${activePage}`}
            role="tabpanel"
            tabIndex={0}
          >
            {sourceVerified && sourceMode === "rendered" ? (
              <div className="rendered-source">
                <div className="rendered-page-wrap">
                  {/* The upload route returns only normalised coordinates; the image is the matching bundled render. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`Rendered synthetic rheumatology PDF, page ${activePage}`}
                    src={`/demo/rheumatology-page-${activePage}.png`}
                  />
                  <div className="citation-overlay" aria-hidden="true">
                    {uploadCitations
                      .filter((citation) => citation.page === activePage)
                      .flatMap((citation) =>
                        citation.rectangles.map((rectangle, index) => {
                          const scale =
                            rectangle.x <= 1 &&
                            rectangle.y <= 1 &&
                            rectangle.width <= 1 &&
                            rectangle.height <= 1
                              ? 100
                              : 1;
                          return (
                            <span
                              className={
                                activeCitation === citation.passageId
                                  ? "citation-rectangle citation-rectangle-active"
                                  : "citation-rectangle"
                              }
                              key={`${citation.id}-${index}`}
                              style={{
                                left: `${rectangle.x * scale}%`,
                                top: `${rectangle.y * scale}%`,
                                width: `${rectangle.width * scale}%`,
                                height: `${rectangle.height * scale}%`,
                              }}
                            />
                          );
                        }),
                      )}
                  </div>
                </div>
                <p className="rendered-caption">
                  <strong>Rendered from the uploaded synthetic PDF</strong>
                  <span>
                    {activeCitation
                      ? `Highlighted source on page ${activePage}.`
                      : "Select a citation to highlight its exact source."}
                  </span>
                </p>
              </div>
            ) : (
              <div
                className="synthetic-letter"
                onMouseUp={onSourceSelection}
                onTouchEnd={onSourceSelection}
              >
                <div className="letterhead">
                  <span>Northbridge University Hospitals</span>
                  <small>Independent synthetic correspondence</small>
                </div>
                <div className="synthetic-stamp" aria-hidden="true">
                  Independent synthetic document · no real patient
                </div>
                <p className="letter-notice">
                  Synthetic letter for product testing. It is not connected to
                  a real patient or NHS organisation.
                </p>
                {pagePassages(fixture, activePage).map((passage) => {
                  const attention =
                    passage.id.includes("not-accepted") ||
                    passage.id.includes("follow-up") ||
                    passage.text.includes("No cardiology appointment") ||
                    passage.text.includes("cannot complete");
                  return (
                    <p
                      className={`${attention ? "passage-attention" : ""} ${
                        activeCitation === passage.id
                          ? "passage-active"
                          : ""
                      }`}
                      data-passage-id={passage.id}
                      key={passage.id}
                    >
                      {passage.text}
                    </p>
                  );
                })}
              </div>
            )}
          </div>

          {sourceMode === "text" || !sourceVerified ? (
            <div className="selection-panel">
              <div className="selection-heading">
                <span className="selection-icon">
                  <QuoteIcon size={18} />
                </span>
                <div>
                  <strong>Selected passage</strong>
                  <small>
                    Select 3–500 characters within one source passage.
                  </small>
                </div>
              </div>
              {selectedText && selectedPassageId ? (
                <>
                  <blockquote>{selectedText}</blockquote>
                  <div className="selection-actions">
                    <button
                      className="button button-small button-secondary"
                      type="button"
                      onClick={explainSelection}
                    >
                      Explain simply
                    </button>
                    <button
                      className="button button-small button-secondary"
                      type="button"
                      onClick={translateSelection}
                    >
                      Translate
                    </button>
                    <button
                      className="button button-small button-primary"
                      type="button"
                      onClick={askAboutSelection}
                    >
                      Ask about this
                    </button>
                    <button
                      className="button button-small button-quiet"
                      type="button"
                      onClick={clearSelection}
                    >
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <p className="selection-empty">
                  No source passage selected.
                </p>
              )}
              <p className="visually-hidden" aria-live="polite">
                {selectionMessage}
              </p>
            </div>
          ) : null}
        </article>

        <article
          className="card explanation-card"
          ref={explanationRef}
          aria-labelledby="explanation-title"
        >
          <div className="card-heading">
            <div>
              <p className="kicker">
                {sourceVerified
                  ? "Explanation of verified example"
                  : "Bundled example explanation"}
              </p>
              <h2 id="explanation-title">What this means</h2>
            </div>
            <span className={`verification-badge ${sourceVerified ? "verified" : ""}`}>
              {sourceVerified ? <CheckIcon size={15} /> : <InfoIcon size={15} />}
              {sourceVerified
                ? "Verified against uploaded PDF"
                : "Checked against bundled example"}
            </span>
          </div>
          <div className="segmented language-segmented" aria-label="Explanation language and detail">
            {(
              [
                ["plain", "Plain English"],
                ["detail", "More detail"],
                ["cy", "Cymraeg"],
                ["pl", "Polski"],
              ] as const
            ).map(([mode, label]) => (
              <button
                aria-pressed={explanationMode === mode}
                key={mode}
                type="button"
                onClick={() => {
                  setExplanationMode(mode);
                  confirmGuided(2, fixtureId);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="explanation-content"
            lang={
              explanationMode === "cy"
                ? "cy"
                : explanationMode === "pl"
                  ? "pl"
                  : "en-GB"
            }
          >
            {explanationMode === "cy" || explanationMode === "pl" ? (
              <p className="translation-notice">
                Demonstration translation only — not professionally reviewed.
              </p>
            ) : null}
            <h3>{explanation.title}</h3>
            <p className="explanation-summary">{explanation.summary}</p>
            <div className="citation-list" aria-label="Explanation citations">
              {explanationCitations.map((citation) => (
                <button
                  className="citation-chip"
                  key={citation.id}
                  type="button"
                  onClick={() => openCitation(citation)}
                >
                  Page {citation.page}
                  <span>View evidence</span>
                </button>
              ))}
            </div>
            <div className={`appointment-alert alert-${fixture.statusTone}`}>
              <span className="alert-icon">
                {fixture.appointment.booked ? (
                  <CheckIcon />
                ) : (
                  <ClockIcon />
                )}
              </span>
              <div>
                <strong>{explanation.appointment}</strong>
                {fixture.appointment.booked && fixture.appointment.location ? (
                  <p>{fixture.appointment.location}</p>
                ) : null}
              </div>
            </div>
            <div className="next-action">
              <p className="kicker">Recommended administrative next step</p>
              <h3>{fixture.nextAction.title}</h3>
              <p>{explanation.nextStep || fixture.nextAction.detail}</p>
              <dl className="action-metadata">
                <div>
                  <dt>Due</dt>
                  <dd>{explanation.due || fixture.nextAction.due || "As stated in the letter"}</dd>
                </div>
                <div>
                  <dt>Fictional contact</dt>
                  <dd>
                    {fixture.contact}
                    <br />
                    {fixture.phone}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="card-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  const first = explanationCitations[0];
                  if (first) openCitation(first);
                }}
              >
                <QuoteIcon size={17} />
                Show source evidence
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={prepareCall}
              >
                <PhoneIcon size={17} />
                Prepare this call
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="card qa-card" aria-labelledby="qa-title">
        <div className="qa-heading">
          <div>
            <p className="kicker">Ask about this letter</p>
            <h2 id="qa-title">Grounded questions and follow-ups</h2>
            <p>
              Answers use only the two-page synthetic source. If the document
              does not say, CareRelay tells you.
            </p>
          </div>
          <span className="qa-boundary">
            <ShieldIcon size={17} />
            {sourceVerified
              ? "Exact PDF verified"
              : fixture.previewOnly
                ? "Bundled preview only"
                : "Bundled example result"}
          </span>
        </div>
        <div className="suggested-questions" aria-label="Suggested questions">
          {fixture.suggestedQuestions.map((suggestion) => (
            <button
              className="suggestion-chip"
              key={suggestion}
              type="button"
              onClick={() => chooseSuggestedQuestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className={`answer-block ${answer.abstained ? "answer-abstained" : ""}`}>
          <div className="answer-label">
            <span>CareRelay answer</span>
            <span className="answer-mode">
              {answer.abstained
                ? "Source boundary"
                : answer.mode === "claude"
                  ? "Claude · verified"
                  : "Local · verified"}
            </span>
          </div>
          <p>{answer.answer || SAFE_ABSTENTION}</p>
          {answer.citations.length > 0 ? (
            <div className="citation-list">
              {answer.citations.map((citation) => (
                <button
                  className="citation-chip"
                  key={citation.id}
                  type="button"
                  onClick={() => openCitation(citation)}
                >
                  Page {citation.page}
                  <span>{citation.quote.slice(0, 46)}…</span>
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="listen-button"
            type="button"
            onClick={() => void listenToAnswer()}
          >
            <VolumeIcon size={17} />
            Listen
          </button>
        </div>
        <form className="question-form" onSubmit={(event) => void submitQuestion(event)}>
          <label className="visually-hidden" htmlFor="grounded-question">
            Ask a question about this letter
          </label>
          <input
            autoComplete="off"
            id="grounded-question"
            maxLength={1000}
            placeholder="Ask a question about this letter…"
            ref={questionInputRef}
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            aria-label={isListening ? "Listening for a question" : "Use voice input"}
            className={`icon-button microphone-button ${isListening ? "is-listening" : ""}`}
            disabled={isListening || questionState === "checking"}
            type="button"
            onClick={startVoiceInput}
          >
            <MicIcon />
          </button>
          <button
            className="button button-primary ask-button"
            disabled={questionState === "checking"}
            type="submit"
          >
            {questionState === "checking" ? "Checking" : "Ask"}
            <ArrowRightIcon size={17} />
          </button>
        </form>
        <div className="live-messages">
          <p aria-live="polite" role="status">
            {questionMessage}
          </p>
          <p aria-live="polite" role="status">
            {voiceMessage}
          </p>
        </div>
      </section>

      <CallRehearsalPanel
        callMessage={callMessage}
        callSeconds={callSeconds}
        fixture={fixture}
        liveCallMessage={liveCallMessage}
        liveCallState={liveCallState}
        liveConsent={liveConsent}
        providerReady={
          providerUi.twilio.state === "connected" &&
          providerUi.twilio.liveCallsEnabled
        }
        rehearsal={rehearsal}
        rehearsalResult={rehearsalResults[fixtureId]}
        ref={callPanelRef}
        onAdvance={advanceRehearsal}
        onConsent={updateRehearsalConsent}
        onEnd={endRehearsal}
        onLiveConsent={setLiveConsent}
        onQueueLiveCall={() => void queueLiveCall()}
        onStart={startRehearsal}
      />
    </div>
  );

  const renderReferrals = () => (
    <div className="view-stack">
      {renderViewHeading(
        "Every referral, one clear next step.",
        "A demonstration overview for people managing several long-term-condition referrals and appointments.",
        "Synthetic workspace",
      )}
      <section className="metric-grid" aria-label="Referral overview">
        <article className="metric-card">
          <strong>3</strong>
          <span>Active pathways</span>
          <small>All synthetic examples</small>
        </article>
        <article className="metric-card metric-amber">
          <strong>1</strong>
          <span>Action due now</span>
          <small>Administrative follow-up</small>
        </article>
        <article className="metric-card metric-green">
          <strong>1</strong>
          <span>Appointment booked</span>
          <small>Preview case only</small>
        </article>
      </section>
      <section className="referral-list" aria-labelledby="active-referrals-title">
        <div className="section-label-row">
          <div>
            <p className="kicker">Synthetic pathways</p>
            <h2 id="active-referrals-title">Active referral examples</h2>
          </div>
        </div>
        {FIXTURE_IDS.map((id) => {
          const item = getFixture(id);
          const result = rehearsalResults[id];
          return (
            <article className="card referral-card" key={id}>
              <div className="referral-main">
                <span className={`status-marker status-${item.statusTone}`} />
                <div>
                  <p className="kicker">{item.reference}</p>
                  <h3>{item.department}</h3>
                  <span className={`status-pill status-${item.statusTone}`}>
                    {STATUS_LABEL[id]}
                  </span>
                </div>
              </div>
              <dl className="referral-details">
                <div>
                  <dt>Received</dt>
                  <dd>{item.receivedDate}</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>{item.nextAction.title}</dd>
                </div>
              </dl>
              {result ? (
                <div className="simulated-update">
                  <CheckIcon size={18} />
                  <div>
                    <strong>Simulated status update</strong>
                    <span>Mock enquiry outcome recorded</span>
                    <small>
                      {result.statusExplanation} {result.nextAction}. No external
                      call was placed.
                    </small>
                  </div>
                </div>
              ) : null}
              <button
                className="button button-secondary referral-open"
                type="button"
                onClick={() => {
                  selectCase(id);
                  navigate("understand");
                }}
              >
                Open case
                <ArrowRightIcon size={17} />
              </button>
            </article>
          );
        })}
      </section>
      <aside className="synthetic-workspace-note">
        <ShieldIcon size={24} />
        <div>
          <h2>This is a synthetic workspace</h2>
          <p>
            Names, references, phone numbers, dates and pathway events are
            invented for testing.
          </p>
        </div>
      </aside>
    </div>
  );

  const renderSafety = () => {
    const actionTime =
      evidence.timeToFirstCorrectActionMs === null
        ? "Not recorded"
        : `${Math.max(0, evidence.timeToFirstCorrectActionMs / 1000).toFixed(1)} s`;
    return (
      <div className="view-stack">
        {renderViewHeading(
          "Designed to support administration, not make clinical decisions.",
          "A transparent account of what this synthetic demonstration can confirm, refuse and record.",
          "Not a clinical safety case",
        )}
        <section className="assurance-grid" aria-label="Core assurances">
          {[
            [
              "Source-grounded answers",
              "Supported claims link to exact fixture passages and page numbers.",
              QuoteIcon,
            ],
            [
              "Administrative scope",
              "Clinical, treatment and urgency questions are refused.",
              ShieldIcon,
            ],
            [
              "Synthetic by default",
              "Only invented cases are available; the upload path accepts one known PDF.",
              DocumentIcon,
            ],
            [
              "Controlled telephony",
              "The standard rehearsal stays local and cannot dial or record.",
              PhoneIcon,
            ],
          ].map(([title, copy, Icon]) => (
            <article className="assurance-card" key={String(title)}>
              <span className="assurance-icon">
                <Icon size={22} />
              </span>
              <h2>{String(title)}</h2>
              <p>{String(copy)}</p>
            </article>
          ))}
        </section>
        <section className="card evidence-card" aria-labelledby="evidence-title">
          <div className="card-heading">
            <div>
              <p className="kicker">Synthetic interaction evidence</p>
              <h2 id="evidence-title">Current browser session</h2>
            </div>
            <span className="boundary-pill">Not a clinical or patient outcome</span>
          </div>
          <div className="evidence-metrics">
            {[
              ["Document analysed", evidence.documentAnalysed ? "Confirmed" : "Not recorded"],
              ["Citations opened", String(evidence.citationsOpened)],
              [
                "Correct action selected",
                evidence.correctActionSelected ? "Confirmed" : "Not recorded",
              ],
              ["Local rehearsal", evidence.rehearsalCompleted ? "Completed" : "Not recorded"],
              ["Time to first correct action", actionTime],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="evidence-footnote">
            This evidence is bound to synthetic fixture CR-RHE-4101. Only
            confirmed actions in this in-memory session are counted. Invalid
            and out-of-order guided events are ignored. Reset or reload clears
            it.
          </p>
          <p className="visually-hidden" aria-live="polite">
            Evidence now records {evidence.citationsOpened} opened citations.
          </p>
        </section>
        <section className="scope-grid" aria-label="Product scope">
          <article className="card scope-card scope-in">
            <p className="kicker">In scope</p>
            <h2>Administrative clarity</h2>
            <ul>
              <li>Explain administrative wording.</li>
              <li>Translate pre-authored explanations while retaining citations.</li>
              <li>Identify dates, references and stated next steps.</li>
              <li>Prepare questions for referral administration.</li>
            </ul>
          </article>
          <article className="card scope-card scope-out">
            <p className="kicker">Out of scope</p>
            <h2>Clinical decisions</h2>
            <ul>
              <li>Diagnose symptoms.</li>
              <li>Recommend treatment.</li>
              <li>Decide urgency or referral acceptance.</li>
              <li>Claim a booking without evidence.</li>
              <li>Contact a real clinic in the normal rehearsal.</li>
            </ul>
          </article>
        </section>
        <section className="card evidence-table-card" aria-labelledby="checks-title">
          <div className="card-heading">
            <div>
              <p className="kicker">Assurance evidence</p>
              <h2 id="checks-title">Bounded behaviour checks</h2>
            </div>
            <span className="case-count">Synthetic prototype</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Expected boundary</th>
                  <th>Demonstration evidence</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Fixture selection", "No silent fallback", "Only the selected fixture is returned"],
                  ["Citation integrity", "Exact quote and page", "Invalid citations cause complete abstention"],
                  ["Unknown information", "Do not infer", "Safe source-boundary answer"],
                  ["Clinical questions", "Administrative scope only", "Diagnosis, treatment and urgency refused"],
                  ["Prompt injection", "Source is evidence, not instruction", "Fixture text cannot override controls"],
                  ["Selected passages", "Exact 1–500 character server match", "Cross-passage selections rejected"],
                  ["Synthetic-data invariants", "No real patient or provider", "Known names, markers and fingerprint required"],
                ].map(([check, boundary, result]) => (
                  <tr key={check}>
                    <th scope="row">{check}</th>
                    <td>{boundary}</td>
                    <td>
                      <span className="table-result">
                        <CheckIcon size={15} />
                        {result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="view-stack">
      {renderViewHeading(
        "Claude-first, with voice and telephony when you are ready.",
        "Optional providers enhance the bounded demonstration. Local grounded answers always remain available.",
        "Local mode always on",
      )}
      <section className="settings-layout">
        <div className="provider-list">
          <div className="section-label-row">
            <div>
              <p className="kicker">Optional providers</p>
              <h2>Configuration and readiness</h2>
            </div>
            <button
              className="button button-small button-secondary"
              type="button"
              onClick={() => void refreshProviders()}
            >
              Refresh status
            </button>
          </div>
          {PROVIDERS.map((provider) => {
            const ui = providerUi[provider.id];
            const expanded = expandedProvider === provider.id;
            return (
              <article className="card provider-card" key={provider.id}>
                <button
                  aria-expanded={expanded}
                  className="provider-summary"
                  type="button"
                  onClick={() =>
                    setExpandedProvider(expanded ? null : provider.id)
                  }
                >
                  <span className="provider-identity">
                    <span className="provider-monogram" aria-hidden="true">
                      {provider.name.slice(0, 1)}
                    </span>
                    <span>
                      <strong>
                        {provider.name}
                        {provider.id === "anthropic" ? " — primary" : ""}
                      </strong>
                      <small>{provider.role}</small>
                    </span>
                  </span>
                  <span className="provider-summary-status">
                    <span className={`provider-status provider-${ui.state}`}>
                      {statusText(ui.state)}
                    </span>
                    <ChevronDownIcon
                      className={expanded ? "chevron-open" : ""}
                    />
                  </span>
                </button>
                {expanded ? (
                  <div className="provider-details">
                    <dl>
                      <div>
                        <dt>Equivalent environment variables</dt>
                        <dd>{provider.env.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt>Configuration source</dt>
                        <dd>{ui.source}</dd>
                      </div>
                      <div>
                        <dt>Privacy boundary</dt>
                        <dd>{provider.privacy}</dd>
                      </div>
                      {provider.id === "twilio" ? (
                        <div>
                          <dt>Fixed live-call flag</dt>
                          <dd>
                            {ui.liveCallsEnabled
                              ? "Enabled for the fixed controlled path"
                              : "Disabled — local rehearsal only"}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="provider-check-row">
                      <p>{ui.message}</p>
                      <button
                        className="button button-secondary"
                        disabled={ui.state === "checking"}
                        type="button"
                        onClick={() => void runProviderCheck(provider.id)}
                      >
                        {ui.state === "checking"
                          ? "Checking…"
                          : "Run readiness check"}
                      </button>
                    </div>
                    <CredentialForm
                      credentials={credentials}
                      disabled={!loopbackHost || savingProvider === provider.id}
                      loopbackHost={loopbackHost}
                      provider={provider.id}
                      showSecrets={showSecrets}
                      onChange={setCredentials}
                      onClear={() => void clearCredentials(provider.id)}
                      onShow={(key) =>
                        setShowSecrets((current) => ({
                          ...current,
                          [key]: !current[key],
                        }))
                      }
                      onSubmit={(event) =>
                        void saveCredentials(provider.id, event)
                      }
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
          <p className="settings-live" aria-live="polite" role="status">
            {providerMessage}
          </p>
        </div>
        <aside className="settings-side">
          <section className="card preference-card" aria-labelledby="preferences-title">
            <p className="kicker">Demonstration preferences</p>
            <h2 id="preferences-title">Local controls</h2>
            <div className="preference-row">
              <span>
                <strong>Keep local grounded mode on</strong>
                <small>Deterministic answers remain available without providers.</small>
              </span>
              <span className="always-on">Always on</span>
            </div>
            <div className="preference-row">
              <span>
                <strong>Allow voice output</strong>
                <small>Uses approved provider speech or device fallback.</small>
              </span>
              <button
                aria-checked={voiceOutputAllowed}
                aria-label="Allow voice output"
                className="switch"
                role="switch"
                type="button"
                onClick={() => {
                  if (voiceOutputAllowed) {
                    cancelVoice("Voice output turned off.");
                  }
                  setVoiceOutputAllowed((allowed) => !allowed);
                }}
              >
                <span />
              </button>
            </div>
          </section>
          <section className="safe-setup-card" aria-labelledby="safe-setup-title">
            <p className="kicker kicker-on-dark">Add a provider safely</p>
            <h2 id="safe-setup-title">Three deliberate steps</h2>
            <ol>
              <li>
                <span>1</span>
                <p>
                  <strong>Use a local development host</strong>
                  Temporary entry is blocked on public hosts.
                </p>
              </li>
              <li>
                <span>2</span>
                <p>
                  <strong>Save only synthetic-demo credentials</strong>
                  Values live only in server-process memory.
                </p>
              </li>
              <li>
                <span>3</span>
                <p>
                  <strong>Run a readiness check</strong>
                  A check does not send a call or clinical information.
                </p>
              </li>
            </ol>
            <p className="safe-setup-boundary">
              This is a development convenience, not a production secret
              manager. Restarting the process clears runtime values.
            </p>
          </section>
        </aside>
      </section>
    </div>
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <Logo />
            <span className="brand-copy">
              <strong>CareRelay</strong>
              <small>Referral clarity, one step at a time</small>
            </span>
          </div>
          <div className="header-boundary">
            <span className="synthetic-label">Synthetic demonstration</span>
            <small>Independent prototype · no NHS connection</small>
          </div>
        </div>
      </header>
      <div className="app-shell">
        <aside className="sidebar">
          <nav aria-label="Primary navigation">
            <p className="nav-kicker">Workspace</p>
            <ul>
              {NAVIGATION.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      aria-current={view === item.id ? "page" : undefined}
                      type="button"
                      onClick={() => navigate(item.id)}
                    >
                      <Icon size={19} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="sidebar-support">
            <ShieldIcon size={19} />
            <span>
              <strong>Administrative support</strong>
              <small>Not medical advice or emergency care</small>
            </span>
          </div>
        </aside>
        <main id="main-content">
          {view === "understand"
            ? renderUnderstand()
            : view === "referrals"
              ? renderReferrals()
              : view === "safety"
                ? renderSafety()
                : renderSettings()}
        </main>
      </div>
      <div className="global-boundary">
        Independent synthetic prototype · administrative support only · not for
        real patient information
      </div>
    </>
  );
}
