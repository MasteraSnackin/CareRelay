import {
  SAFE_ABSTENTION,
  getPassage,
  type Fixture,
  type FixturePassage,
} from "./fixtures";

export { SAFE_ABSTENTION } from "./fixtures";

export interface GroundedClaim {
  text: string;
  citationIds: string[];
}

export interface GroundedCitation {
  id: string;
  page: number;
  passageId: string;
  quote: string;
}

export interface GroundedAnswer {
  answer: string;
  claims: GroundedClaim[];
  citations: GroundedCitation[];
  abstained: boolean;
  mode: "claude" | "deterministic";
}

export type AdministrativeIntentId =
  | "rheumatology.appointment"
  | "rheumatology.acceptance"
  | "rheumatology.next-step"
  | "rheumatology.received"
  | "rheumatology.review"
  | "rheumatology.contact"
  | "diabetes.appointment"
  | "diabetes.location"
  | "diabetes.cannot-attend"
  | "diabetes.next-step"
  | "diabetes.received"
  | "cardiology.missing-information"
  | "cardiology.next-step"
  | "cardiology.appointment"
  | "cardiology.gp-request"
  | "cardiology.contact"
  | "selected.explain";

export interface AdministrativeIntentOption {
  id: AdministrativeIntentId;
  description: string;
}

const FIXTURE_INTENTS: Record<Fixture["id"], readonly AdministrativeIntentOption[]> = {
  rheumatology: [
    {
      id: "rheumatology.appointment",
      description: "Whether an appointment is booked.",
    },
    {
      id: "rheumatology.acceptance",
      description: "Whether the referral is accepted.",
    },
    {
      id: "rheumatology.next-step",
      description: "The documented administrative next step or follow-up.",
    },
    {
      id: "rheumatology.received",
      description: "When the referral was received.",
    },
    {
      id: "rheumatology.review",
      description: "What the letter says about review.",
    },
    {
      id: "rheumatology.contact",
      description: "The documented referral-administration contact details.",
    },
  ],
  diabetes: [
    {
      id: "diabetes.appointment",
      description: "The booked appointment date, time and arrival time.",
    },
    {
      id: "diabetes.location",
      description: "The documented appointment location.",
    },
    {
      id: "diabetes.cannot-attend",
      description: "What the letter says to do if unable to attend.",
    },
    {
      id: "diabetes.next-step",
      description: "The documented administrative next step.",
    },
    {
      id: "diabetes.received",
      description: "When the referral was received.",
    },
  ],
  cardiology: [
    {
      id: "cardiology.missing-information",
      description: "Which existing record is missing.",
    },
    {
      id: "cardiology.next-step",
      description: "The documented administrative next step.",
    },
    {
      id: "cardiology.appointment",
      description: "Whether an appointment is booked.",
    },
    {
      id: "cardiology.gp-request",
      description: "What the GP practice was asked to send.",
    },
    {
      id: "cardiology.contact",
      description: "The documented referral-administration contact details.",
    },
  ],
};

const CANONICAL_INTENT_QUESTIONS: Record<AdministrativeIntentId, string> = {
  "rheumatology.appointment": "Has my appointment been booked?",
  "rheumatology.acceptance": "Was my referral accepted?",
  "rheumatology.next-step": "What should I do next?",
  "rheumatology.received": "When was the referral received?",
  "rheumatology.review": "Who will review the referral?",
  "rheumatology.contact": "Who should I contact?",
  "diabetes.appointment": "When is my appointment?",
  "diabetes.location": "Where should I go?",
  "diabetes.cannot-attend": "What if I cannot attend?",
  "diabetes.next-step": "What should I do next?",
  "diabetes.received": "When was the referral received?",
  "cardiology.missing-information": "What information is missing?",
  "cardiology.next-step": "What should I do next?",
  "cardiology.appointment": "Has an appointment been booked?",
  "cardiology.gp-request": "What was the GP practice asked to send?",
  "cardiology.contact": "Who should I contact?",
  "selected.explain": "Explain this selected passage",
};

export function safeAbstention(
  mode: GroundedAnswer["mode"] = "deterministic",
): GroundedAnswer {
  return {
    answer: SAFE_ABSTENTION,
    claims: [],
    citations: [],
    abstained: true,
    mode,
  };
}

export function validateSelectedText(
  fixture: Fixture,
  selectedText: string,
): FixturePassage | undefined {
  if (
    selectedText.length < 1 ||
    selectedText.length > 500 ||
    selectedText.trim().length === 0
  ) {
    return undefined;
  }

  const matches = fixture.passages.filter((passage) =>
    passage.text.includes(selectedText),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function citationFor(passage: FixturePassage): GroundedCitation {
  return {
    id: `citation:${passage.id}`,
    page: passage.page,
    passageId: passage.id,
    quote: passage.text,
  };
}

function answerFromClaims(
  fixture: Fixture,
  claims: Array<{ text: string; passageIds: string[] }>,
): GroundedAnswer {
  const passageIds = [...new Set(claims.flatMap((claim) => claim.passageIds))];
  const passages = passageIds
    .map((passageId) => getPassage(fixture, passageId))
    .filter((passage): passage is FixturePassage => passage !== undefined);
  if (passages.length !== passageIds.length || claims.length === 0) {
    return safeAbstention();
  }

  const citations = passages.map(citationFor);
  const groundedClaims = claims.map((claim) => ({
    text: claim.text,
    citationIds: claim.passageIds.map((id) => `citation:${id}`),
  }));
  return {
    answer: groundedClaims.map((claim) => claim.text).join(" "),
    claims: groundedClaims,
    citations,
    abstained: false,
    mode: "deterministic",
  };
}

function normaliseQuestionForSafety(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/[^\p{L}\p{N}&+]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const PROMPT_INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override|bypass|break|evade)\b.{0,60}\b(?:instruction|rule|prompt|system|developer|policy|guardrail|safety)\b/u,
  /\bi\s*g\s*n\s*o\s*r\s*e\b.{0,60}\b(?:instruction|rule|prompt|system|developer|policy|guardrail|safety)\b/u,
  /\b(?:reveal|show|print|repeat|expose)\b.{0,60}\b(?:secret|credential|api key|prompt|system|developer|policy)\b/u,
  /\b(?:act as|pretend to be|roleplay as)\b.{0,40}\b(?:doctor|clinician|system|developer|administrator)\b/u,
  /\b(?:jailbreak|prompt injection|developer mode|do anything now|follow my instructions)\b/u,
] as const;

const CLINICAL_PATTERNS = [
  /\b(?:diagnos\p{L}*|treat\p{L}*|medicat\p{L}*|medicine|prescription|drug|tablet|pill|dose|dosage|therapy|surgery)\b/u,
  /\b(?:m\s*e\s*d\s*i\s*c\s*a\s*t\s*i\s*o\s*n|d\s*i\s*a\s*g\s*n\s*o\s*s\s*i\s*s)\b/u,
  /\b(?:insulin|antibiotic\p{L}*|steroid\p{L}*|methotrexate|aspirin|paracetamol|inject\p{L}*|side effects?|prognosis|contagious|fasting|blood pressure|blood sugar|glucose|heart rate)\b/u,
  /\b(?:symptom\p{L}*|pain|bleeding|breathless|breathing|faint|fever|rash|swelling|pregnan\p{L}*|cancer|disease|condition)\b/u,
  /\b(?:urgent|urgency|emergency|serious|severity|dangerous|safe to wait|life threatening|dying|survive|ambulance|hospital now|a&e|999|111)\b/u,
  /\b(?:should|can|must|do)\s+i\s+(?:take|stop|start|change|wait|eat|drink|fast|exercise|inject|go to hospital|call an ambulance|(?:have|get|arrange) (?:a )?(?:test|scan|x ray))\b/u,
  /\b(?:need|have) to (?:eat|drink|fast|exercise|inject)\b/u,
  /\b(?:normal|abnormal|interpret|meaning|mean)\b.{0,30}\b(?:blood|lab|scan|x ray|test|result)\b/u,
  /\b(?:test|scan|result)s?\b.{0,30}\b(?:ok|okay|good|bad|concerning)\b/u,
  // Common Welsh and Polish clinical terms. The administrative allow-list
  // below remains the primary boundary for other languages.
  /\b(?:meddyginiaeth|tabledi|triniaeth|diagnosis|symptomau|brys|argyfwng|poważne|pilne|nagłe|diagnoza|leczenie|leki|tabletki|objawy)\b/u,
] as const;

const ADMINISTRATIVE_PATTERN =
  /\b(?:referral|appointment|booking|booked|accepted|acceptance|received|review|reference|contact|phone|call|letter|page|passage|source|where|when|arrive|attend|cancel|missing|information|gp practice|next step|what (?:should|do) i do|what happens(?: next)?|follow up)\b/u;

export function isUnsafeQuestion(question: string): boolean {
  const normalised = normaliseQuestionForSafety(question);
  return (
    PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalised)) ||
    CLINICAL_PATTERNS.some((pattern) => pattern.test(normalised))
  );
}

export function isAllowedAdministrativeQuestion(
  fixture: Fixture,
  question: string,
  selectedText?: string,
): boolean {
  if (isUnsafeQuestion(question)) {
    return false;
  }
  if (
    selectedText !== undefined &&
    validateSelectedText(fixture, selectedText) !== undefined
  ) {
    return true;
  }
  return ADMINISTRATIVE_PATTERN.test(normaliseQuestionForSafety(question));
}

function includesAny(value: string, expressions: RegExp[]): boolean {
  return expressions.some((expression) => expression.test(value));
}

function rheumatologyAnswer(
  fixture: Fixture,
  question: string,
): GroundedAnswer | undefined {
  if (includesAny(question, [/\bappointment\b/u, /\bbook(?:ed|ing)?\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "No appointment has been booked.",
        passageIds: ["rheumatology:p1:not-accepted"],
      },
    ]);
  }
  if (includesAny(question, [/\baccept(?:ed|ance)?\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "The letter does not confirm that the referral has been accepted.",
        passageIds: ["rheumatology:p1:not-accepted"],
      },
    ]);
  }
  if (
    includesAny(question, [
      /\bwhat (?:should|do) i do\b/u,
      /\bwhat happens next\b/u,
      /\bnext (?:action|step)\b/u,
      /\bfollow[- ]?up\b/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "Contact Rheumatology Referral Administration because the stated wait-until date was 14 July 2026.",
        passageIds: ["rheumatology:p2:follow-up"],
      },
      {
        text: "Quote referral reference CR-RHE-4101.",
        passageIds: ["rheumatology:p2:reference"],
      },
    ]);
  }
  if (includesAny(question, [/\bwhen\b.*\breceiv/u, /\breceived\b.*\bwhen\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "The referral was received on 16 June 2026.",
        passageIds: ["rheumatology:p1:received"],
      },
    ]);
  }
  if (includesAny(question, [/\bwho\b.*\breview/u, /\breview(?:ed|ing)?\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "The letter says a member of the clinical team will review the information supplied by the GP practice.",
        passageIds: ["rheumatology:p1:review"],
      },
    ]);
  }
  if (includesAny(question, [/\bcontact\b/u, /\bphone\b/u, /\bcall\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "Contact Rheumatology Referral Administration on 020 7946 0000.",
        passageIds: ["rheumatology:p2:follow-up"],
      },
      {
        text: "Quote CR-RHE-4101.",
        passageIds: ["rheumatology:p2:reference"],
      },
    ]);
  }
  return undefined;
}

function diabetesAnswer(
  fixture: Fixture,
  question: string,
): GroundedAnswer | undefined {
  if (
    includesAny(question, [
      /\bwhen\b/u,
      /\bwhat (?:date|time)\b/u,
      /\bappointment\b.*\bbook/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "The diabetes clinic appointment is booked for Wednesday 5 August 2026 at 10:20.",
        passageIds: ["diabetes:p1:appointment"],
      },
      {
        text: "Arrive 10 minutes early.",
        passageIds: ["diabetes:p1:arrival"],
      },
    ]);
  }
  if (includesAny(question, [/\bwhere\b/u, /\blocation\b/u, /\bgo\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "Go to Outpatient Reception, West Wing, Level 2.",
        passageIds: ["diabetes:p1:location"],
      },
    ]);
  }
  if (
    includesAny(question, [
      /\bcannot attend\b/u,
      /\bcan't attend\b/u,
      /\bunable to attend\b/u,
      /\bcancel\b/u,
      /\bmiss\b/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "Call the Diabetes Booking Office at least 48 hours before the appointment if you cannot attend.",
        passageIds: ["diabetes:p2:cancellation"],
      },
      {
        text: "Quote appointment reference CR-DIA-2207.",
        passageIds: ["diabetes:p2:reference"],
      },
    ]);
  }
  if (
    includesAny(question, [
      /\bwhat (?:should|do) i do\b/u,
      /\bnext (?:action|step)\b/u,
      /\bwhat happens next\b/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "Attend the booked appointment and arrive at 10:10 for the 10:20 start.",
        passageIds: ["diabetes:p1:appointment", "diabetes:p1:arrival"],
      },
      {
        text: "Report to Outpatient Reception, West Wing, Level 2.",
        passageIds: ["diabetes:p1:location"],
      },
    ]);
  }
  if (includesAny(question, [/\breceived\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "The referral was received on 2 July 2026.",
        passageIds: ["diabetes:p1:received"],
      },
    ]);
  }
  return undefined;
}

function cardiologyAnswer(
  fixture: Fixture,
  question: string,
): GroundedAnswer | undefined {
  if (
    includesAny(question, [
      /\bwhat\b.*\bmissing\b/u,
      /\bmissing information\b/u,
      /\bblood[- ]test\b/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "The referral was missing a copy of the recent blood-test results listed on the referral form.",
        passageIds: ["cardiology:p1:missing"],
      },
      {
        text: "This is a request for an existing record, not for you to arrange a new test.",
        passageIds: ["cardiology:p2:boundary"],
      },
    ]);
  }
  if (
    includesAny(question, [
      /\bwhat (?:should|do) i do\b/u,
      /\bnext (?:action|step)\b/u,
      /\bwhat happens next\b/u,
    ])
  ) {
    return answerFromClaims(fixture, [
      {
        text: "Ask the GP practice for an update if the information has not been sent by 29 July 2026.",
        passageIds: ["cardiology:p2:follow-up"],
      },
      {
        text: "You can ask Cardiology Referral Administration whether it has arrived and quote CR-CAR-3094.",
        passageIds: [
          "cardiology:p2:contact",
          "cardiology:p2:reference",
        ],
      },
    ]);
  }
  if (includesAny(question, [/\bappointment\b/u, /\bbook(?:ed|ing)?\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "No cardiology appointment has been booked at this stage.",
        passageIds: ["cardiology:p1:no-appointment"],
      },
    ]);
  }
  if (includesAny(question, [/\bwho\b.*\bsend/u, /\bgp practice\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "The GP practice administration team has been asked to send the missing copy.",
        passageIds: ["cardiology:p1:gp-request"],
      },
    ]);
  }
  if (includesAny(question, [/\bcontact\b/u, /\bphone\b/u, /\bcall\b/u])) {
    return answerFromClaims(fixture, [
      {
        text: "You can contact Cardiology Referral Administration on 020 7946 0200 to ask whether the information has arrived.",
        passageIds: ["cardiology:p2:contact"],
      },
      {
        text: "Quote CR-CAR-3094.",
        passageIds: ["cardiology:p2:reference"],
      },
    ]);
  }
  return undefined;
}

export function deterministicAnswer(
  fixture: Fixture,
  question: string,
  selectedText?: string,
): GroundedAnswer {
  if (isUnsafeQuestion(question)) {
    return safeAbstention();
  }

  if (selectedText !== undefined) {
    const passage = validateSelectedText(fixture, selectedText);
    if (!passage) {
      return safeAbstention();
    }
    if (
      includesAny(question.toLowerCase(), [
        /\bexplain\b/u,
        /\bwhat does\b/u,
        /\bselected\b/u,
        /\bthis\b/u,
      ])
    ) {
      return answerFromClaims(fixture, [
        {
          text: `The selected passage states: “${selectedText}”`,
          passageIds: [passage.id],
        },
      ]);
    }
  }

  const normalised = question.toLowerCase().replace(/\s+/gu, " ").trim();
  const answer =
    fixture.id === "rheumatology"
      ? rheumatologyAnswer(fixture, normalised)
      : fixture.id === "diabetes"
        ? diabetesAnswer(fixture, normalised)
        : cardiologyAnswer(fixture, normalised);
  return answer ?? safeAbstention();
}

export function administrativeIntentOptions(
  fixture: Fixture,
  selectedText?: string,
): AdministrativeIntentOption[] {
  const options = [...FIXTURE_INTENTS[fixture.id]];
  if (
    selectedText !== undefined &&
    validateSelectedText(fixture, selectedText) !== undefined
  ) {
    options.push({
      id: "selected.explain",
      description:
        "Restate the exact selected fixture excerpt without adding information.",
    });
  }
  return options;
}

export function answerAdministrativeIntent(
  fixture: Fixture,
  intentId: AdministrativeIntentId,
  selectedText?: string,
): GroundedAnswer {
  const allowed = administrativeIntentOptions(fixture, selectedText).some(
    ({ id }) => id === intentId,
  );
  if (!allowed) {
    return safeAbstention("claude");
  }
  const canonicalQuestion = CANONICAL_INTENT_QUESTIONS[intentId];
  const answer = deterministicAnswer(
    fixture,
    canonicalQuestion,
    intentId === "selected.explain" ? selectedText : undefined,
  );
  if (answer.abstained) {
    return safeAbstention("claude");
  }
  return { ...answer, mode: "claude" };
}

export function resolveProviderIntent(
  candidate: unknown,
  fixture: Fixture,
  selectedText?: string,
): GroundedAnswer {
  if (!isObject(candidate)) {
    return safeAbstention("claude");
  }
  const keys = Object.keys(candidate);
  if (
    keys.length !== 1 ||
    keys[0] !== "intentId" ||
    typeof candidate.intentId !== "string"
  ) {
    return safeAbstention("claude");
  }
  if (candidate.intentId === "abstain") {
    return safeAbstention("claude");
  }
  const option = administrativeIntentOptions(fixture, selectedText).find(
    ({ id }) => id === candidate.intentId,
  );
  return option
    ? answerAdministrativeIntent(fixture, option.id, selectedText)
    : safeAbstention("claude");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function validateGroundedAnswer(
  candidate: unknown,
  fixture: Fixture,
): GroundedAnswer {
  if (!isObject(candidate)) {
    return safeAbstention("claude");
  }
  const { answer, claims, citations, abstained, mode } = candidate;
  if (
    typeof answer !== "string" ||
    !Array.isArray(claims) ||
    !Array.isArray(citations) ||
    typeof abstained !== "boolean" ||
    mode !== "claude"
  ) {
    return safeAbstention("claude");
  }

  if (abstained) {
    return answer === SAFE_ABSTENTION &&
      claims.length === 0 &&
      citations.length === 0
      ? safeAbstention("claude")
      : safeAbstention("claude");
  }
  if (claims.length === 0 || citations.length === 0) {
    return safeAbstention("claude");
  }

  const parsedCitations: GroundedCitation[] = [];
  const citationIds = new Set<string>();
  for (const value of citations) {
    if (!isObject(value)) {
      return safeAbstention("claude");
    }
    const { id, page, passageId, quote } = value;
    if (
      typeof id !== "string" ||
      !id ||
      citationIds.has(id) ||
      typeof page !== "number" ||
      !Number.isInteger(page) ||
      typeof passageId !== "string" ||
      typeof quote !== "string" ||
      quote.trim().length === 0
    ) {
      return safeAbstention("claude");
    }
    const passage = getPassage(fixture, passageId);
    if (
      !passage ||
      passage.page !== page ||
      !passage.text.includes(quote)
    ) {
      return safeAbstention("claude");
    }
    citationIds.add(id);
    parsedCitations.push({ id, page, passageId, quote });
  }

  const parsedClaims: GroundedClaim[] = [];
  const referencedIds = new Set<string>();
  for (const value of claims) {
    if (!isObject(value)) {
      return safeAbstention("claude");
    }
    const text = value.text;
    const ids = value.citationIds;
    if (
      typeof text !== "string" ||
      !text ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id): id is string => typeof id === "string" && citationIds.has(id))
    ) {
      return safeAbstention("claude");
    }
    ids.forEach((id) => referencedIds.add(id));
    parsedClaims.push({ text, citationIds: [...ids] });
  }

  if (
    parsedClaims.map((claim) => claim.text).join(" ") !== answer ||
    referencedIds.size !== citationIds.size
  ) {
    return safeAbstention("claude");
  }

  const structurallyValid: GroundedAnswer = {
    answer,
    claims: parsedClaims,
    citations: parsedCitations,
    abstained: false,
    mode: "claude",
  };

  // Legacy provider-answer validation remains exported for compatibility, but
  // provider-authored prose is accepted only when it is byte-for-byte
  // equivalent to one of the server-owned administrative answers.
  const allowed = administrativeIntentOptions(fixture)
    .map(({ id }) => answerAdministrativeIntent(fixture, id))
    .find(
      (candidateAnswer) =>
        !candidateAnswer.abstained &&
        candidateAnswer.answer === structurallyValid.answer &&
        JSON.stringify(candidateAnswer.claims) ===
          JSON.stringify(structurallyValid.claims) &&
        JSON.stringify(candidateAnswer.citations) ===
          JSON.stringify(structurallyValid.citations),
    );
  return allowed ? structurallyValid : safeAbstention("claude");
}
