import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const FIXED_DATE = new Date("2026-06-22T09:00:00.000Z");
const PUBLIC_DIRECTORY = resolve("public");
const OUTPUT_DIRECTORY = resolve("public/demo");
const PDF_PATH = join(
  OUTPUT_DIRECTORY,
  "rheumatology-referral-synthetic.pdf",
);
const MANIFEST_PATH = join(
  OUTPUT_DIRECTORY,
  "rheumatology-fixture-manifest.json",
);
const SOCIAL_CARD_PATH = resolve("public/care-relay-social-card.png");
const ANALYSIS_SOURCE_PATH = resolve("lib/document-analysis.ts");

// Updated only when the intentional fixture content or its stable layout changes.
export const EXPECTED_PDF_SHA256 =
  "87a10dfd1401f6ee538a74aa1ffa767b1b6fcf3426fe0938335a16242f2d0924";

// Raster output is byte-sensitive. Deliberate regeneration therefore uses the
// exact renderer version that produced the committed PNG hashes.
export const REQUIRED_GHOSTSCRIPT_VERSION = "10.06.0";

const NOTICE =
  "Synthetic letter for product testing. It is not connected to a real patient or NHS organisation.";
const SYNTHETIC_MARKER =
  "INDEPENDENT SYNTHETIC DOCUMENT - NO REAL PATIENT";

type Passage = {
  id: string;
  page: 1 | 2;
  role: string;
  text: string;
};

type NormalisedRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PassagePlacement = Passage & {
  rectangles: NormalisedRectangle[];
};

type PngDimensions = {
  width: number;
  height: number;
};

type FixtureManifest = {
  schemaVersion: 2;
  fixtureId: "rheumatology";
  reference: "CR-RHE-4101";
  generatedAt: string;
  generator: {
    source: "scripts/generate-fixture.ts";
    pdfLibrary: "pdf-lib@1.17.1";
    rasteriser: {
      name: "Ghostscript";
      requiredVersion: string;
      pageResolutionDpi: 144;
      socialCardResolutionDpi: 72;
    };
  };
  pageSize: {
    unit: "points";
    width: number;
    height: number;
  };
  markers: string[];
  files: {
    pdf: FixtureFile;
    pageOnePng: FixturePngFile;
    pageTwoPng: FixturePngFile;
    socialCardPng: FixturePngFile;
  };
  passages: PassagePlacement[];
};

type FixtureFile = {
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
};

type FixturePngFile = FixtureFile & PngDimensions;

type AssetPaths = {
  pdf: string;
  pageOnePng: string;
  pageTwoPng: string;
  socialCardPng: string;
  manifest: string;
};

const PASSAGES: readonly Passage[] = [
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
    role: "received",
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
    role: "next-step",
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
    role: "boundary",
    text: "This letter contains administrative information only. Follow any separate advice already given to you by a healthcare professional.",
  },
  {
    id: "rheumatology:p2:sign-off",
    page: 2,
    role: "sign-off",
    text: "Rheumatology Referral Administration",
  },
] as const;

const palette = {
  forest: rgb(0x12 / 255, 0x3b / 255, 0x3b / 255),
  ink: rgb(0x16 / 255, 0x31 / 255, 0x31 / 255),
  inkSoft: rgb(0x49 / 255, 0x61 / 255, 0x60 / 255),
  mint: rgb(0xa7 / 255, 0xe8 / 255, 0xd5 / 255),
  mintPale: rgb(0xe7 / 255, 0xf4 / 255, 0xf0 / 255),
  amber: rgb(0x8f / 255, 0x52 / 255, 0),
  amberPale: rgb(1, 0xf5 / 255, 0xde / 255),
  line: rgb(0xdb / 255, 0xe4 / 255, 0xe1 / 255),
  paper: rgb(1, 0xfe / 255, 0xfa / 255),
  white: rgb(1, 1, 1),
};

function round(value: number): number {
  return Number(value.toFixed(6));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line.length > 0 ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.length > 0) {
      lines.push(line);
      line = word;
      continue;
    }
    throw new Error(`Word does not fit within the stable text block: ${word}`);
  }

  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

function drawWrappedPassage({
  page,
  passage,
  font,
  size,
  x,
  y,
  width,
  lineHeight,
  colour = palette.ink,
}: {
  page: PDFPage;
  passage: Passage;
  font: PDFFont;
  size: number;
  x: number;
  y: number;
  width: number;
  lineHeight: number;
  colour?: ReturnType<typeof rgb>;
}): PassagePlacement {
  const lines = wrapText(passage.text, font, size, width);
  const rectangles: NormalisedRectangle[] = [];

  lines.forEach((line, index) => {
    const baselineY = y - index * lineHeight;
    const lineWidth = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x,
      y: baselineY,
      size,
      font,
      color: colour,
    });
    rectangles.push({
      x: round(x / A4_WIDTH),
      y: round((A4_HEIGHT - baselineY - size * 1.08) / A4_HEIGHT),
      width: round(lineWidth / A4_WIDTH),
      height: round((size * 1.32) / A4_HEIGHT),
    });
  });

  return { ...passage, rectangles };
}

function drawMark(page: PDFPage, x: number, y: number) {
  page.drawRectangle({
    x,
    y,
    width: 32,
    height: 32,
    color: palette.forest,
  });
  page.drawRectangle({
    x: x + 7,
    y: y + 15,
    width: 13,
    height: 8,
    color: palette.mint,
  });
  page.drawRectangle({
    x: x + 12,
    y: y + 8,
    width: 13,
    height: 8,
    color: rgb(0x72 / 255, 0xce / 255, 0xb5 / 255),
  });
  page.drawCircle({
    x: x + 25,
    y: y + 24,
    size: 2.6,
    color: rgb(0xf0 / 255, 0xb1 / 255, 0x4a / 255),
  });
}

function drawSharedPageChrome(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  pageNumber: number,
) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    color: palette.paper,
  });
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 42,
    width: A4_WIDTH,
    height: 42,
    color: palette.forest,
  });
  page.drawText(SYNTHETIC_MARKER, {
    x: 54,
    y: A4_HEIGHT - 27,
    size: 10.1,
    font: fonts.bold,
    color: palette.white,
  });
  drawMark(page, 54, 735);
  page.drawText("Northbridge University Hospitals", {
    x: 96,
    y: 754,
    size: 14.2,
    font: fonts.bold,
    color: palette.forest,
  });
  page.drawText("Fictional organisation for product testing", {
    x: 96,
    y: 739,
    size: 9.2,
    font: fonts.regular,
    color: palette.inkSoft,
  });
  page.drawLine({
    start: { x: 54, y: 721 },
    end: { x: A4_WIDTH - 54, y: 721 },
    thickness: 0.8,
    color: palette.line,
  });
  page.drawRectangle({
    x: 54,
    y: 65,
    width: A4_WIDTH - 108,
    height: 48,
    color: palette.mintPale,
    borderColor: palette.line,
    borderWidth: 0.8,
  });
  const noticeLines = wrapText(NOTICE, fonts.bold, 9.2, A4_WIDTH - 138);
  noticeLines.forEach((line, index) => {
    page.drawText(line, {
      x: 69,
      y: 91 - index * 12,
      size: 9.2,
      font: fonts.bold,
      color: palette.forest,
    });
  });
  page.drawText(`Synthetic fixture CR-RHE-4101  |  Page ${pageNumber} of 2`, {
    x: 54,
    y: 39,
    size: 8.5,
    font: fonts.regular,
    color: palette.inkSoft,
  });
  page.drawText("Administrative information only", {
    x: A4_WIDTH - 194,
    y: 39,
    size: 8.5,
    font: fonts.bold,
    color: palette.amber,
  });
}

async function createFixturePdf() {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle("CareRelay synthetic rheumatology referral fixture");
  pdf.setAuthor("CareRelay independent synthetic prototype");
  pdf.setSubject("Synthetic administrative referral letter for product testing");
  pdf.setKeywords([
    "CareRelay",
    "synthetic",
    "no real patient",
    "administrative support",
  ]);
  pdf.setProducer("CareRelay deterministic fixture generator");
  pdf.setCreator("CareRelay deterministic fixture generator");
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.catalog.set(PDFName.of("Lang"), pdf.context.obj("en-GB"));

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const fonts = { regular, bold };
  const placements: PassagePlacement[] = [];

  const pageOne = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  drawSharedPageChrome(pageOne, fonts, 1);
  pageOne.drawText("SYNTHETIC REFERRAL LETTER", {
    x: 425,
    y: 753,
    size: 8.5,
    font: bold,
    color: palette.amber,
  });
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[0],
      font: serifBold,
      size: 20,
      x: 54,
      y: 674,
      width: 487,
      lineHeight: 25,
    }),
  );
  pageOne.drawRectangle({
    x: 54,
    y: 616,
    width: 487,
    height: 34,
    color: palette.amberPale,
  });
  pageOne.drawText("Referral reference", {
    x: 68,
    y: 631,
    size: 8.5,
    font: bold,
    color: palette.amber,
  });
  pageOne.drawText("CR-RHE-4101", {
    x: 169,
    y: 627.5,
    size: 13,
    font: bold,
    color: palette.forest,
  });
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[1],
      font: serif,
      size: 12.2,
      x: 54,
      y: 577,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[2],
      font: serif,
      size: 12.2,
      x: 54,
      y: 536,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[3],
      font: serif,
      size: 12.2,
      x: 54,
      y: 478,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  pageOne.drawRectangle({
    x: 48,
    y: 368,
    width: 499,
    height: 76,
    color: palette.amberPale,
    borderColor: rgb(0xeb / 255, 0xd1 / 255, 0x9a / 255),
    borderWidth: 0.8,
  });
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[4],
      font: serifBold,
      size: 12.2,
      x: 62,
      y: 419,
      width: 471,
      lineHeight: 18.5,
      colour: palette.ink,
    }),
  );
  placements.push(
    drawWrappedPassage({
      page: pageOne,
      passage: PASSAGES[5],
      font: serif,
      size: 12.2,
      x: 54,
      y: 325,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  pageOne.drawText("This fixture does not confirm referral acceptance or a booking.", {
    x: 54,
    y: 252,
    size: 10,
    font: bold,
    color: palette.amber,
  });

  const pageTwo = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  drawSharedPageChrome(pageTwo, fonts, 2);
  pageTwo.drawText("SYNTHETIC REFERRAL LETTER", {
    x: 425,
    y: 753,
    size: 8.5,
    font: bold,
    color: palette.amber,
  });
  placements.push(
    drawWrappedPassage({
      page: pageTwo,
      passage: PASSAGES[6],
      font: serifBold,
      size: 22,
      x: 54,
      y: 674,
      width: 487,
      lineHeight: 27,
    }),
  );
  pageTwo.drawRectangle({
    x: 48,
    y: 530,
    width: 499,
    height: 104,
    color: palette.amberPale,
    borderColor: rgb(0xeb / 255, 0xd1 / 255, 0x9a / 255),
    borderWidth: 0.8,
  });
  pageTwo.drawText("FOLLOW-UP DATE", {
    x: 62,
    y: 608,
    size: 8.5,
    font: bold,
    color: palette.amber,
  });
  placements.push(
    drawWrappedPassage({
      page: pageTwo,
      passage: PASSAGES[7],
      font: serifBold,
      size: 12.2,
      x: 62,
      y: 582,
      width: 471,
      lineHeight: 18.5,
    }),
  );
  placements.push(
    drawWrappedPassage({
      page: pageTwo,
      passage: PASSAGES[8],
      font: serif,
      size: 12.2,
      x: 54,
      y: 486,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  pageTwo.drawLine({
    start: { x: 54, y: 431 },
    end: { x: 541, y: 431 },
    thickness: 0.8,
    color: palette.line,
  });
  placements.push(
    drawWrappedPassage({
      page: pageTwo,
      passage: PASSAGES[9],
      font: serif,
      size: 12.2,
      x: 54,
      y: 397,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  placements.push(
    drawWrappedPassage({
      page: pageTwo,
      passage: PASSAGES[10],
      font: serifBold,
      size: 12.2,
      x: 54,
      y: 307,
      width: 487,
      lineHeight: 17.5,
    }),
  );
  pageTwo.drawText("Northbridge University Hospitals", {
    x: 54,
    y: 281,
    size: 10.5,
    font: regular,
    color: palette.inkSoft,
  });
  pageTwo.drawText("Fictional contact: 020 7946 0000", {
    x: 54,
    y: 246,
    size: 9.5,
    font: bold,
    color: palette.amber,
  });

  const bytes = await pdf.save({
    addDefaultPage: false,
    objectsPerTick: Number.POSITIVE_INFINITY,
    updateFieldAppearances: false,
    useObjectStreams: false,
  });
  return { bytes, placements };
}

async function createSocialCardPdf(path: string) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle("CareRelay social card");
  pdf.setAuthor("CareRelay independent synthetic prototype");
  pdf.setProducer("CareRelay deterministic fixture generator");
  pdf.setCreator("CareRelay deterministic fixture generator");
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const page = pdf.addPage([1200, 630]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: 1200,
    height: 630,
    color: rgb(0xf6 / 255, 0xf7 / 255, 0xf3 / 255),
  });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 38,
    height: 630,
    color: palette.mint,
  });
  page.drawCircle({
    x: 1070,
    y: 540,
    size: 180,
    color: palette.mintPale,
    opacity: 0.72,
  });
  page.drawCircle({
    x: 1140,
    y: 20,
    size: 255,
    color: palette.amberPale,
    opacity: 0.68,
  });
  page.drawRectangle({
    x: 86,
    y: 462,
    width: 82,
    height: 82,
    color: palette.forest,
  });
  page.drawRectangle({
    x: 104,
    y: 502,
    width: 34,
    height: 19,
    color: palette.mint,
  });
  page.drawRectangle({
    x: 118,
    y: 482,
    width: 34,
    height: 19,
    color: rgb(0x72 / 255, 0xce / 255, 0xb5 / 255),
  });
  page.drawCircle({
    x: 151,
    y: 524,
    size: 7,
    color: rgb(0xf0 / 255, 0xb1 / 255, 0x4a / 255),
  });
  page.drawText("CareRelay", {
    x: 190,
    y: 486,
    size: 41,
    font: bold,
    color: palette.forest,
  });
  page.drawText("Understand the letter.", {
    x: 86,
    y: 360,
    size: 59,
    font: serif,
    color: palette.ink,
  });
  page.drawText("Verify the source.", {
    x: 86,
    y: 286,
    size: 59,
    font: serif,
    color: palette.ink,
  });
  page.drawText("Prepare the next administrative action.", {
    x: 88,
    y: 210,
    size: 29,
    font: regular,
    color: palette.inkSoft,
  });
  page.drawRectangle({
    x: 86,
    y: 96,
    width: 656,
    height: 54,
    color: palette.forest,
  });
  page.drawText("Independent synthetic prototype - no NHS connection", {
    x: 116,
    y: 115,
    size: 18,
    font: bold,
    color: palette.white,
  });
  const bytes = await pdf.save({
    addDefaultPage: false,
    objectsPerTick: Number.POSITIVE_INFINITY,
    updateFieldAppearances: false,
    useObjectStreams: false,
  });
  await writeFile(path, bytes);
}

function runGhostscript(args: string[]) {
  const result = spawnSync("gs", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(
      `Ghostscript is required to render the fixture: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Ghostscript failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
}

function getGhostscriptVersion(): string {
  const result = spawnSync("gs", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(
      `Ghostscript ${REQUIRED_GHOSTSCRIPT_VERSION} is required to regenerate fixture PNGs: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not read the Ghostscript version (status ${String(result.status)}): ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function assertGhostscriptVersion(): string {
  const version = getGhostscriptVersion();
  if (version !== REQUIRED_GHOSTSCRIPT_VERSION) {
    throw new Error(
      `Fixture PNG generation is pinned to Ghostscript ${REQUIRED_GHOSTSCRIPT_VERSION}; found ${version}. Use npm run check:fixture to verify committed artefacts without rerendering them.`,
    );
  }
  return version;
}

async function renderAssets(paths: AssetPaths, workingDirectory: string) {
  assertGhostscriptVersion();
  runGhostscript([
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=pngalpha",
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    "-r144",
    `-sOutputFile=${join(workingDirectory, "demo/rheumatology-page-%d.png")}`,
    paths.pdf,
  ]);

  const socialPdf = join(workingDirectory, "social-card.pdf");
  await createSocialCardPdf(socialPdf);
  runGhostscript([
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=pngalpha",
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    "-r72",
    `-sOutputFile=${paths.socialCardPng}`,
    socialPdf,
  ]);
}

function pngDimensions(bytes: Uint8Array): PngDimensions {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    buffer.byteLength < 24 ||
    !buffer.subarray(0, signature.byteLength).equals(signature) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Expected a PNG with a valid signature and IHDR chunk.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function pngRecord(
  path: string,
  manifestPath: string,
): Promise<FixturePngFile> {
  const bytes = await readFile(path);
  return {
    path: manifestPath,
    mediaType: "image/png",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    ...pngDimensions(bytes),
  };
}

async function createManifest(
  digest: string,
  placements: PassagePlacement[],
  pdfBytes: Uint8Array,
  paths: AssetPaths,
): Promise<FixtureManifest> {
  return {
    schemaVersion: 2,
    fixtureId: "rheumatology",
    reference: "CR-RHE-4101",
    generatedAt: FIXED_DATE.toISOString(),
    generator: {
      source: "scripts/generate-fixture.ts",
      pdfLibrary: "pdf-lib@1.17.1",
      rasteriser: {
        name: "Ghostscript",
        requiredVersion: REQUIRED_GHOSTSCRIPT_VERSION,
        pageResolutionDpi: 144,
        socialCardResolutionDpi: 72,
      },
    },
    pageSize: {
      unit: "points" as const,
      width: A4_WIDTH,
      height: A4_HEIGHT,
    },
    markers: [NOTICE, SYNTHETIC_MARKER],
    files: {
      pdf: {
        path: "rheumatology-referral-synthetic.pdf",
        mediaType: "application/pdf",
        bytes: pdfBytes.byteLength,
        sha256: digest,
      },
      pageOnePng: await pngRecord(
        paths.pageOnePng,
        "rheumatology-page-1.png",
      ),
      pageTwoPng: await pngRecord(
        paths.pageTwoPng,
        "rheumatology-page-2.png",
      ),
      socialCardPng: await pngRecord(
        paths.socialCardPng,
        "../care-relay-social-card.png",
      ),
    },
    passages: placements,
  };
}

function assertEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description} differs: expected ${String(expected)}, found ${String(actual)}`,
    );
  }
}

async function verifyFile(
  path: string,
  record: FixtureFile,
  expectedPath: string,
  expectedMediaType: string,
): Promise<Uint8Array> {
  assertEqual(record.path, expectedPath, `${expectedPath} manifest path`);
  assertEqual(
    record.mediaType,
    expectedMediaType,
    `${expectedPath} manifest media type`,
  );
  const bytes = await readFile(path);
  assertEqual(bytes.byteLength, record.bytes, `${expectedPath} byte size`);
  assertEqual(sha256(bytes), record.sha256, `${expectedPath} SHA-256`);
  return bytes;
}

async function verifyPng(
  path: string,
  record: FixturePngFile,
  expectedPath: string,
  expectedDimensions: PngDimensions,
): Promise<void> {
  const bytes = await verifyFile(path, record, expectedPath, "image/png");
  const dimensions = pngDimensions(bytes);
  assertEqual(
    dimensions.width,
    expectedDimensions.width,
    `${expectedPath} width`,
  );
  assertEqual(
    dimensions.height,
    expectedDimensions.height,
    `${expectedPath} height`,
  );
  assertEqual(record.width, dimensions.width, `${expectedPath} manifest width`);
  assertEqual(
    record.height,
    dimensions.height,
    `${expectedPath} manifest height`,
  );
}

async function verifyManifest(
  manifest: FixtureManifest,
  paths: AssetPaths,
  generatedPdfBytes: Uint8Array,
  placements: PassagePlacement[],
): Promise<void> {
  assertEqual(manifest.schemaVersion, 2, "manifest schema version");
  assertEqual(manifest.fixtureId, "rheumatology", "manifest fixture ID");
  assertEqual(manifest.reference, "CR-RHE-4101", "manifest reference");
  assertEqual(
    manifest.generatedAt,
    FIXED_DATE.toISOString(),
    "manifest generation date",
  );
  assertEqual(manifest.pageSize?.unit, "points", "manifest page-size unit");
  assertEqual(manifest.pageSize?.width, A4_WIDTH, "manifest page width");
  assertEqual(manifest.pageSize?.height, A4_HEIGHT, "manifest page height");
  assertEqual(
    manifest.generator?.source,
    "scripts/generate-fixture.ts",
    "manifest generator source",
  );
  assertEqual(
    manifest.generator?.pdfLibrary,
    "pdf-lib@1.17.1",
    "manifest PDF library",
  );
  assertEqual(
    manifest.generator?.rasteriser?.name,
    "Ghostscript",
    "manifest rasteriser",
  );
  assertEqual(
    manifest.generator?.rasteriser?.requiredVersion,
    REQUIRED_GHOSTSCRIPT_VERSION,
    "manifest Ghostscript version boundary",
  );
  assertEqual(
    manifest.generator?.rasteriser?.pageResolutionDpi,
    144,
    "manifest page resolution",
  );
  assertEqual(
    manifest.generator?.rasteriser?.socialCardResolutionDpi,
    72,
    "manifest social-card resolution",
  );
  assertEqual(
    JSON.stringify(manifest.markers),
    JSON.stringify([NOTICE, SYNTHETIC_MARKER]),
    "manifest synthetic markers",
  );
  assertEqual(
    JSON.stringify(manifest.passages),
    JSON.stringify(placements),
    "manifest passage placements",
  );

  const pdfBytes = await verifyFile(
    paths.pdf,
    manifest.files.pdf,
    "rheumatology-referral-synthetic.pdf",
    "application/pdf",
  );
  assertEqual(
    sha256(generatedPdfBytes),
    EXPECTED_PDF_SHA256,
    "generated PDF SHA-256",
  );
  assertEqual(
    sha256(pdfBytes),
    EXPECTED_PDF_SHA256,
    "committed PDF SHA-256",
  );
  assertEqual(
    manifest.files.pdf.sha256,
    EXPECTED_PDF_SHA256,
    "manifest PDF SHA-256",
  );

  await verifyPng(
    paths.pageOnePng,
    manifest.files.pageOnePng,
    "rheumatology-page-1.png",
    { width: 1191, height: 1684 },
  );
  await verifyPng(
    paths.pageTwoPng,
    manifest.files.pageTwoPng,
    "rheumatology-page-2.png",
    { width: 1191, height: 1684 },
  );
  await verifyPng(
    paths.socialCardPng,
    manifest.files.socialCardPng,
    "../care-relay-social-card.png",
    { width: 1200, height: 630 },
  );
}

async function verifyHashAuthority(): Promise<void> {
  const source = await readFile(ANALYSIS_SOURCE_PATH, "utf8");
  const match = source.match(
    /EXPECTED_RHEUMATOLOGY_PDF_SHA256\s*=\s*["']([a-f0-9]{64})["']/,
  );
  if (!match) {
    throw new Error(
      "Could not locate EXPECTED_RHEUMATOLOGY_PDF_SHA256 in lib/document-analysis.ts.",
    );
  }
  assertEqual(
    match[1],
    EXPECTED_PDF_SHA256,
    "upload verifier and fixture generator PDF SHA-256 authorities",
  );
}

function committedAssetPaths(): AssetPaths {
  return {
    pdf: PDF_PATH,
    pageOnePng: join(OUTPUT_DIRECTORY, "rheumatology-page-1.png"),
    pageTwoPng: join(OUTPUT_DIRECTORY, "rheumatology-page-2.png"),
    socialCardPng: SOCIAL_CARD_PATH,
    manifest: MANIFEST_PATH,
  };
}

function stagedAssetPaths(stagingDirectory: string): AssetPaths {
  return {
    pdf: join(
      stagingDirectory,
      "demo/rheumatology-referral-synthetic.pdf",
    ),
    pageOnePng: join(stagingDirectory, "demo/rheumatology-page-1.png"),
    pageTwoPng: join(stagingDirectory, "demo/rheumatology-page-2.png"),
    socialCardPng: join(stagingDirectory, "care-relay-social-card.png"),
    manifest: join(
      stagingDirectory,
      "demo/rheumatology-fixture-manifest.json",
    ),
  };
}

async function commitStagedAssets(paths: AssetPaths): Promise<void> {
  const committed = committedAssetPaths();
  // All files have already been generated and verified. Each rename is an
  // atomic same-filesystem replacement; the manifest is committed last so it
  // never advertises assets that have not yet reached their public paths.
  await rename(paths.pdf, committed.pdf);
  await rename(paths.pageOnePng, committed.pageOnePng);
  await rename(paths.pageTwoPng, committed.pageTwoPng);
  await rename(paths.socialCardPng, committed.socialCardPng);
  await rename(paths.manifest, committed.manifest);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const { bytes, placements } = await createFixturePdf();
  const digest = sha256(bytes);

  if (EXPECTED_PDF_SHA256.startsWith("PENDING_")) {
    if (checkOnly) {
      throw new Error(
        "Set EXPECTED_PDF_SHA256 after the first intentional generation.",
      );
    }
  } else if (digest !== EXPECTED_PDF_SHA256) {
    throw new Error(
      `Fixture reproducibility failure: expected ${EXPECTED_PDF_SHA256}, generated ${digest}`,
    );
  }

  if (checkOnly) {
    const manifestText = await readFile(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(manifestText) as FixtureManifest;
    const expectedManifest = await createManifest(
      digest,
      placements,
      bytes,
      committedAssetPaths(),
    );
    assertEqual(
      manifestText,
      `${JSON.stringify(expectedManifest, null, 2)}\n`,
      "committed fixture manifest",
    );
    await verifyManifest(
      manifest,
      committedAssetPaths(),
      bytes,
      placements,
    );
    await verifyHashAuthority();
    process.stdout.write(
      [
        "CareRelay fixture reproducible",
        "Complete committed fixture set verified",
        `PDF SHA-256 ${digest}`,
        `Page 1 PNG SHA-256 ${manifest.files.pageOnePng.sha256}`,
        `Page 2 PNG SHA-256 ${manifest.files.pageTwoPng.sha256}`,
        `Social card SHA-256 ${manifest.files.socialCardPng.sha256}`,
        `Raster generation boundary Ghostscript ${REQUIRED_GHOSTSCRIPT_VERSION}`,
        "",
      ].join("\n"),
    );
    return;
  }

  await mkdir(PUBLIC_DIRECTORY, { recursive: true });
  await mkdir(dirname(PDF_PATH), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(PUBLIC_DIRECTORY), ".carerelay-fixture-"),
  );
  const stagedPaths = stagedAssetPaths(stagingDirectory);
  try {
    await mkdir(dirname(stagedPaths.pdf), { recursive: true });
    await writeFile(stagedPaths.pdf, bytes);
    await renderAssets(stagedPaths, stagingDirectory);
    const manifest = await createManifest(
      digest,
      placements,
      bytes,
      stagedPaths,
    );
    await writeFile(
      stagedPaths.manifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await verifyManifest(manifest, stagedPaths, bytes, placements);
    await verifyHashAuthority();
    await commitStagedAssets(stagedPaths);
    process.stdout.write(
      [
        "CareRelay synthetic fixture generated atomically",
        `PDF ${PDF_PATH}`,
        `PDF SHA-256 ${digest}`,
        `Page 1 PNG SHA-256 ${manifest.files.pageOnePng.sha256}`,
        `Page 2 PNG SHA-256 ${manifest.files.pageTwoPng.sha256}`,
        `Social card SHA-256 ${manifest.files.socialCardPng.sha256}`,
        `Manifest ${MANIFEST_PATH}`,
        `Raster generation boundary Ghostscript ${REQUIRED_GHOSTSCRIPT_VERSION}`,
        "",
      ].join("\n"),
    );
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

await main();
