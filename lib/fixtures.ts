export type FixtureId = "rheumatology" | "diabetes" | "cardiology";

export type StatusTone = "amber" | "green" | "blue";
export type ExplanationLanguage = "plain" | "detail" | "cy" | "pl";

export interface FixturePassage {
  id: string;
  page: number;
  role: string;
  text: string;
}

export interface FixturePage {
  page: number;
  title: string;
  passageIds: string[];
}

export interface FixtureExplanation {
  title: string;
  summary: string;
  appointment: string;
  nextStep: string;
  due?: string;
  citationIds: string[];
  language: "en" | "cy" | "pl";
  translationNotice?: string;
}

export interface Fixture {
  id: FixtureId;
  patientLabel: "Sample Patient";
  organisation: "Northbridge University Hospitals";
  scope: "administrative only";
  notice: typeof SYNTHETIC_NOTICE;
  department: string;
  title: string;
  reference: string;
  status: string;
  statusTone: StatusTone;
  receivedDate: string;
  letterDate: string;
  contact: string;
  phone: string;
  nextAction: {
    title: string;
    detail: string;
    due?: string;
  };
  appointment: {
    booked: boolean;
    label: string;
    date?: string;
    time?: string;
    arrivalTime?: string;
    location?: string;
  };
  pages: FixturePage[];
  passages: FixturePassage[];
  explanations: Record<ExplanationLanguage, FixtureExplanation>;
  suggestedQuestions: string[];
  previewOnly: boolean;
}

export const SYNTHETIC_NOTICE =
  "Synthetic letter for product testing. It is not connected to a real patient or NHS organisation.";

export const SAFE_ABSTENTION =
  "I cannot answer that from the supplied document. Check the source letter or contact the referral administration team.";

const TRANSLATION_NOTICE =
  "Demonstration translation only — not professionally reviewed.";

const rheumatologyPassages: FixturePassage[] = [
  {
    id: "rheumatology:p1:heading",
    page: 1,
    role: "heading",
    text: "Rheumatology Referral Service — 22 June 2026",
  },
  {
    id: "rheumatology:p1:salutation",
    page: 1,
    role: "salutation",
    text: "Dear Sample Patient,",
  },
  {
    id: "rheumatology:p1:introduction",
    page: 1,
    role: "introduction",
    text: "Thank you for speaking with your GP practice about your referral.",
  },
  {
    id: "rheumatology:p1:received",
    page: 1,
    role: "referral-received",
    text: "We confirm that your referral was received on 16 June 2026.",
  },
  {
    id: "rheumatology:p1:not-accepted",
    page: 1,
    role: "status",
    text: "This letter does not mean your referral has been accepted and no appointment has been booked.",
  },
  {
    id: "rheumatology:p1:review",
    page: 1,
    role: "next-process-step",
    text: "A member of the clinical team will review the information supplied by your GP practice.",
  },
  {
    id: "rheumatology:p2:heading",
    page: 2,
    role: "heading",
    text: "What happens next",
  },
  {
    id: "rheumatology:p2:follow-up",
    page: 2,
    role: "follow-up",
    text: "If you have not heard from us by 14 July 2026, please contact our referral administration team on 020 7946 0000.",
  },
  {
    id: "rheumatology:p2:reference",
    page: 2,
    role: "reference",
    text: "Please quote referral reference CR-RHE-4101 whenever you contact us.",
  },
  {
    id: "rheumatology:p2:boundary",
    page: 2,
    role: "administrative-boundary",
    text: "This letter contains administrative information only. Follow any separate advice already given to you by a healthcare professional.",
  },
  {
    id: "rheumatology:p2:sign-off",
    page: 2,
    role: "sign-off",
    text: "Rheumatology Referral Administration",
  },
];

const diabetesPassages: FixturePassage[] = [
  {
    id: "diabetes:p1:received",
    page: 1,
    role: "referral-received",
    text: "We received the referral from your GP practice on 2 July 2026.",
  },
  {
    id: "diabetes:p1:appointment",
    page: 1,
    role: "appointment",
    text: "Your diabetes clinic appointment is booked for Wednesday 5 August 2026 at 10:20.",
  },
  {
    id: "diabetes:p1:location",
    page: 1,
    role: "location",
    text: "Please report to the Outpatient Reception, West Wing, Level 2.",
  },
  {
    id: "diabetes:p1:arrival",
    page: 1,
    role: "arrival",
    text: "Please arrive 10 minutes before the appointment so reception can check your booking details.",
  },
  {
    id: "diabetes:p2:cancellation",
    page: 2,
    role: "cancellation",
    text: "If you cannot attend, please call the Diabetes Booking Office on 020 7946 0100 at least 48 hours before the appointment.",
  },
  {
    id: "diabetes:p2:reference",
    page: 2,
    role: "reference",
    text: "Quote appointment reference CR-DIA-2207 when you contact us.",
  },
  {
    id: "diabetes:p2:boundary",
    page: 2,
    role: "administrative-boundary",
    text: "This letter confirms booking arrangements only and does not contain treatment advice.",
  },
];

const cardiologyPassages: FixturePassage[] = [
  {
    id: "cardiology:p1:received",
    page: 1,
    role: "referral-received",
    text: "We received your cardiology referral on 8 July 2026.",
  },
  {
    id: "cardiology:p1:missing",
    page: 1,
    role: "missing-information",
    text: "The referral did not include a copy of the recent blood test results listed on the referral form.",
  },
  {
    id: "cardiology:p1:blocked",
    page: 1,
    role: "status",
    text: "We cannot complete the referral administration check until this information is received.",
  },
  {
    id: "cardiology:p1:no-appointment",
    page: 1,
    role: "appointment",
    text: "No cardiology appointment has been booked at this stage.",
  },
  {
    id: "cardiology:p1:gp-request",
    page: 1,
    role: "next-process-step",
    text: "We have asked your GP practice administration team to send the missing copy.",
  },
  {
    id: "cardiology:p2:follow-up",
    page: 2,
    role: "follow-up",
    text: "If the information has not been sent by 29 July 2026, please contact your GP practice to ask for an update.",
  },
  {
    id: "cardiology:p2:contact",
    page: 2,
    role: "contact",
    text: "You can ask Cardiology Referral Administration whether the information has arrived by calling 020 7946 0200.",
  },
  {
    id: "cardiology:p2:reference",
    page: 2,
    role: "reference",
    text: "Please quote referral reference CR-CAR-3094 whenever you contact us.",
  },
  {
    id: "cardiology:p2:boundary",
    page: 2,
    role: "administrative-boundary",
    text: "This is an administrative request for an existing record. It is not a request for you to arrange a new test.",
  },
];

function pagesFor(passages: FixturePassage[], titles: [string, string]): FixturePage[] {
  return [1, 2].map((page) => ({
    page,
    title: titles[page - 1] ?? `Page ${page}`,
    passageIds: passages.filter((passage) => passage.page === page).map((passage) => passage.id),
  }));
}

export const FIXTURES: Record<FixtureId, Fixture> = {
  rheumatology: {
    id: "rheumatology",
    patientLabel: "Sample Patient",
    organisation: "Northbridge University Hospitals",
    scope: "administrative only",
    notice: SYNTHETIC_NOTICE,
    department: "Rheumatology",
    title: "Rheumatology referral letter",
    reference: "CR-RHE-4101",
    status: "Follow-up due",
    statusTone: "amber",
    receivedDate: "16 June 2026",
    letterDate: "22 June 2026",
    contact: "Rheumatology Referral Administration",
    phone: "020 7946 0000",
    nextAction: {
      title: "Contact the referral team",
      detail: "Ask whether the referral has been reviewed and quote CR-RHE-4101.",
      due: "Due now in this synthetic scenario",
    },
    appointment: {
      booked: false,
      label: "No appointment has been booked.",
    },
    pages: pagesFor(rheumatologyPassages, [
      "Rheumatology Referral Service",
      "What happens next",
    ]),
    passages: rheumatologyPassages,
    explanations: {
      plain: {
        title: "Your referral is waiting to be reviewed",
        summary:
          "The rheumatology team received your referral. They have not accepted it yet, and you do not have an appointment. The date they asked you to wait until has passed, so you can contact the referral team now.",
        appointment: "No appointment has been booked. Do not travel to the clinic unless a booking is confirmed.",
        nextStep: "Ask whether the referral has been reviewed and quote CR-RHE-4101.",
        due: "Due now in this synthetic scenario",
        citationIds: [
          "rheumatology:p1:received",
          "rheumatology:p1:not-accepted",
          "rheumatology:p2:follow-up",
          "rheumatology:p2:reference",
        ],
        language: "en",
      },
      detail: {
        title: "The referral has been received but not accepted",
        summary:
          "Northbridge University Hospitals says it received the referral on 16 June 2026. A clinical team member is expected to review the information, but this administrative letter does not confirm acceptance or a booking. Its follow-up date was 14 July 2026.",
        appointment: "No appointment has been booked. Do not travel to the clinic unless a booking is confirmed.",
        nextStep: "Contact Rheumatology Referral Administration and quote CR-RHE-4101.",
        due: "Due now in this synthetic scenario",
        citationIds: [
          "rheumatology:p1:received",
          "rheumatology:p1:not-accepted",
          "rheumatology:p1:review",
          "rheumatology:p2:follow-up",
          "rheumatology:p2:reference",
        ],
        language: "en",
      },
      cy: {
        title: "Mae eich atgyfeiriad yn aros i gael ei adolygu",
        summary:
          "Mae'r tîm rhiwmatoleg wedi cael eich atgyfeiriad. Nid ydynt wedi ei dderbyn eto, ac nid oes gennych apwyntiad. Mae'r dyddiad a nodwyd ar gyfer aros wedi mynd heibio, felly gallwch gysylltu â'r tîm atgyfeirio nawr.",
        appointment: "Nid oes apwyntiad wedi'i drefnu. Peidiwch â theithio i'r clinig oni bai bod trefniant wedi'i gadarnhau.",
        nextStep: "Gofynnwch a yw'r atgyfeiriad wedi'i adolygu a dyfynnwch CR-RHE-4101.",
        due: "Yn ddyledus nawr yn y senario synthetig hwn",
        citationIds: [
          "rheumatology:p1:received",
          "rheumatology:p1:not-accepted",
          "rheumatology:p2:follow-up",
          "rheumatology:p2:reference",
        ],
        language: "cy",
        translationNotice: TRANSLATION_NOTICE,
      },
      pl: {
        title: "Twoje skierowanie czeka na sprawdzenie",
        summary:
          "Zespół reumatologii otrzymał skierowanie. Nie zostało ono jeszcze przyjęte i nie masz umówionej wizyty. Podany termin oczekiwania minął, więc możesz teraz skontaktować się z zespołem skierowań.",
        appointment: "Wizyta nie została umówiona. Nie jedź do kliniki bez potwierdzonej rezerwacji.",
        nextStep: "Zapytaj, czy skierowanie zostało sprawdzone, i podaj numer CR-RHE-4101.",
        due: "Termin upłynął w tym syntetycznym scenariuszu",
        citationIds: [
          "rheumatology:p1:received",
          "rheumatology:p1:not-accepted",
          "rheumatology:p2:follow-up",
          "rheumatology:p2:reference",
        ],
        language: "pl",
        translationNotice: TRANSLATION_NOTICE,
      },
    },
    suggestedQuestions: [
      "Has my appointment been booked?",
      "What should I do next?",
      "Was my referral accepted?",
    ],
    previewOnly: false,
  },
  diabetes: {
    id: "diabetes",
    patientLabel: "Sample Patient",
    organisation: "Northbridge University Hospitals",
    scope: "administrative only",
    notice: SYNTHETIC_NOTICE,
    department: "Diabetes clinic",
    title: "Diabetes clinic appointment letter",
    reference: "CR-DIA-2207",
    status: "Appointment booked",
    statusTone: "green",
    receivedDate: "2 July 2026",
    letterDate: "12 July 2026",
    contact: "Diabetes Booking Office",
    phone: "020 7946 0100",
    nextAction: {
      title: "Attend the booked appointment",
      detail: "Arrive at 10:10 for the 10:20 appointment.",
      due: "Wednesday 5 August 2026",
    },
    appointment: {
      booked: true,
      label: "Wednesday 5 August 2026 at 10:20",
      date: "Wednesday 5 August 2026",
      time: "10:20",
      arrivalTime: "10:10",
      location: "Outpatient Reception, West Wing, Level 2",
    },
    pages: pagesFor(diabetesPassages, ["Appointment details", "If you cannot attend"]),
    passages: diabetesPassages,
    explanations: {
      plain: {
        title: "Your diabetes clinic appointment is booked",
        summary:
          "Your appointment is on Wednesday 5 August 2026 at 10:20. Go to Outpatient Reception in the West Wing on Level 2 and arrive at 10:10.",
        appointment: "Appointment booked for Wednesday 5 August 2026 at 10:20.",
        nextStep: "Arrive at Outpatient Reception at 10:10. If you cannot attend, call at least 48 hours beforehand and quote CR-DIA-2207.",
        due: "Wednesday 5 August 2026",
        citationIds: [
          "diabetes:p1:appointment",
          "diabetes:p1:location",
          "diabetes:p1:arrival",
          "diabetes:p2:cancellation",
          "diabetes:p2:reference",
        ],
        language: "en",
      },
      detail: {
        title: "A booking has been confirmed",
        summary:
          "The letter confirms a diabetes clinic booking for 10:20 on Wednesday 5 August 2026 and asks you to arrive ten minutes early at Outpatient Reception, West Wing, Level 2.",
        appointment: "Appointment booked for Wednesday 5 August 2026 at 10:20.",
        nextStep: "Attend at 10:10, or call the Diabetes Booking Office at least 48 hours beforehand if you cannot attend.",
        due: "Wednesday 5 August 2026",
        citationIds: [
          "diabetes:p1:appointment",
          "diabetes:p1:location",
          "diabetes:p1:arrival",
          "diabetes:p2:cancellation",
        ],
        language: "en",
      },
      cy: {
        title: "Mae eich apwyntiad clinig diabetes wedi'i drefnu",
        summary:
          "Mae eich apwyntiad am 10:20 ddydd Mercher 5 Awst 2026. Ewch i Dderbynfa Cleifion Allanol, Adain y Gorllewin, Lefel 2, a chyrhaeddwch am 10:10.",
        appointment: "Apwyntiad wedi'i drefnu am 10:20 ddydd Mercher 5 Awst 2026.",
        nextStep: "Cyrhaeddwch am 10:10. Os na allwch ddod, ffoniwch o leiaf 48 awr ymlaen llaw a dyfynnwch CR-DIA-2207.",
        due: "Dydd Mercher 5 Awst 2026",
        citationIds: [
          "diabetes:p1:appointment",
          "diabetes:p1:location",
          "diabetes:p1:arrival",
          "diabetes:p2:cancellation",
        ],
        language: "cy",
        translationNotice: TRANSLATION_NOTICE,
      },
      pl: {
        title: "Wizyta w poradni diabetologicznej jest umówiona",
        summary:
          "Wizyta odbędzie się w środę 5 sierpnia 2026 o 10:20. Zgłoś się do recepcji ambulatoryjnej w zachodnim skrzydle na poziomie 2 o 10:10.",
        appointment: "Wizyta umówiona na środę 5 sierpnia 2026 o 10:20.",
        nextStep: "Przyjdź o 10:10. Jeśli nie możesz przyjść, zadzwoń co najmniej 48 godzin wcześniej i podaj CR-DIA-2207.",
        due: "Środa 5 sierpnia 2026",
        citationIds: [
          "diabetes:p1:appointment",
          "diabetes:p1:location",
          "diabetes:p1:arrival",
          "diabetes:p2:cancellation",
        ],
        language: "pl",
        translationNotice: TRANSLATION_NOTICE,
      },
    },
    suggestedQuestions: [
      "When is my appointment?",
      "Where should I go?",
      "What if I cannot attend?",
    ],
    previewOnly: true,
  },
  cardiology: {
    id: "cardiology",
    patientLabel: "Sample Patient",
    organisation: "Northbridge University Hospitals",
    scope: "administrative only",
    notice: SYNTHETIC_NOTICE,
    department: "Cardiology",
    title: "Cardiology referral letter",
    reference: "CR-CAR-3094",
    status: "Information needed",
    statusTone: "blue",
    receivedDate: "8 July 2026",
    letterDate: "10 July 2026",
    contact: "Cardiology Referral Administration",
    phone: "020 7946 0200",
    nextAction: {
      title: "Ask the GP practice to confirm the information was sent",
      detail: "If necessary, contact cardiology and quote CR-CAR-3094. This is not a request to arrange a new test.",
      due: "If it has not been sent by 29 July 2026",
    },
    appointment: {
      booked: false,
      label: "No cardiology appointment has been booked at this stage.",
    },
    pages: pagesFor(cardiologyPassages, ["Information needed", "What to do next"]),
    passages: cardiologyPassages,
    explanations: {
      plain: {
        title: "An existing record is missing from the referral",
        summary:
          "Cardiology received the referral, but it did not include a copy of the recent blood-test results listed on the form. The GP practice has been asked to send that copy. This is not a request for you to arrange a new test.",
        appointment: "No cardiology appointment has been booked. Do not travel to the clinic unless a booking is confirmed.",
        nextStep: "Ask the GP practice to confirm the information was sent. If necessary, contact cardiology and quote CR-CAR-3094.",
        due: "If it has not been sent by 29 July 2026",
        citationIds: [
          "cardiology:p1:missing",
          "cardiology:p1:no-appointment",
          "cardiology:p1:gp-request",
          "cardiology:p2:follow-up",
          "cardiology:p2:reference",
          "cardiology:p2:boundary",
        ],
        language: "en",
      },
      detail: {
        title: "The administrative check is waiting for a document copy",
        summary:
          "The letter says the referral administration check cannot be completed until a copy of already-existing blood-test results arrives. The GP practice has been asked to send it. It does not ask the patient to arrange another test.",
        appointment: "No cardiology appointment has been booked. Do not travel to the clinic unless a booking is confirmed.",
        nextStep: "Ask the GP practice for an update after 29 July 2026 if the copy has not been sent, and quote CR-CAR-3094 if contacting cardiology.",
        due: "If it has not been sent by 29 July 2026",
        citationIds: [
          "cardiology:p1:missing",
          "cardiology:p1:blocked",
          "cardiology:p1:gp-request",
          "cardiology:p2:follow-up",
          "cardiology:p2:reference",
          "cardiology:p2:boundary",
        ],
        language: "en",
      },
      cy: {
        title: "Mae cofnod presennol ar goll o'r atgyfeiriad",
        summary:
          "Cafodd cardioleg yr atgyfeiriad, ond nid oedd copi o ganlyniadau diweddar y profion gwaed a restrwyd ar y ffurflen. Gofynnwyd i'r practis meddyg teulu anfon y copi. Nid cais i chi drefnu prawf newydd yw hwn.",
        appointment: "Nid oes apwyntiad cardioleg wedi'i drefnu. Peidiwch â theithio i'r clinig oni bai bod trefniant wedi'i gadarnhau.",
        nextStep: "Gofynnwch i'r practis meddyg teulu gadarnhau bod yr wybodaeth wedi'i hanfon. Os oes angen, cysylltwch â cardioleg a dyfynnwch CR-CAR-3094.",
        due: "Os nad yw wedi'i hanfon erbyn 29 Gorffennaf 2026",
        citationIds: [
          "cardiology:p1:missing",
          "cardiology:p1:no-appointment",
          "cardiology:p1:gp-request",
          "cardiology:p2:follow-up",
          "cardiology:p2:boundary",
        ],
        language: "cy",
        translationNotice: TRANSLATION_NOTICE,
      },
      pl: {
        title: "W skierowaniu brakuje kopii istniejącego dokumentu",
        summary:
          "Kardiologia otrzymała skierowanie, ale nie dołączono kopii ostatnich wyników badań krwi wymienionych w formularzu. Poproszono przychodnię lekarza rodzinnego o przesłanie kopii. Nie jest to prośba o wykonanie nowego badania.",
        appointment: "Wizyta kardiologiczna nie została umówiona. Nie jedź do kliniki bez potwierdzonej rezerwacji.",
        nextStep: "Poproś przychodnię lekarza rodzinnego o potwierdzenie wysłania informacji. W razie potrzeby skontaktuj się z kardiologią i podaj CR-CAR-3094.",
        due: "Jeśli nie wysłano do 29 lipca 2026",
        citationIds: [
          "cardiology:p1:missing",
          "cardiology:p1:no-appointment",
          "cardiology:p1:gp-request",
          "cardiology:p2:follow-up",
          "cardiology:p2:boundary",
        ],
        language: "pl",
        translationNotice: TRANSLATION_NOTICE,
      },
    },
    suggestedQuestions: [
      "What information is missing?",
      "What should I do next?",
      "Has an appointment been booked?",
    ],
    previewOnly: true,
  },
};

export function isFixtureId(value: unknown): value is FixtureId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FIXTURES, value);
}

export function getFixture(id: FixtureId | string): Fixture {
  if (!isFixtureId(id)) {
    throw new Error(`Unknown fixture: ${String(id)}`);
  }

  return FIXTURES[id];
}

export function getPassage(fixture: Fixture, passageId: string): FixturePassage | undefined {
  return fixture.passages.find((passage) => passage.id === passageId);
}
