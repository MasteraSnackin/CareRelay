import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

function safeBaseUrl(host: string | null, protocol: string | null): URL {
  if (host && /^[a-z0-9.[\]:_-]+(?::\d+)?$/iu.test(host)) {
    try {
      const safeProtocol = protocol === "https" ? "https" : "http";
      return new URL(`${safeProtocol}://${host}`);
    } catch {
      // Fall through to the configured origin for malformed host/port values.
    }
  }

  try {
    const configured = new URL(
      process.env.CARERELAY_PUBLIC_URL ?? "http://localhost:3000",
    );
    if (
      configured.protocol === "http:" ||
      configured.protocol === "https:"
    ) {
      return configured;
    }
  } catch {
    // Fall through to the fixed development origin.
  }
  return new URL("http://localhost:3000");
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const baseUrl = safeBaseUrl(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const socialImage = new URL("/og.png", baseUrl).toString();

  return {
    metadataBase: baseUrl,
    title: "CareRelay · Synthetic referral clarity",
    description:
      "Understand a synthetic referral letter, verify every answer against its source page, and rehearse the next administrative action.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      title: "CareRelay · Referral clarity, one step at a time",
      description:
        "An independent synthetic demonstration for evidence-backed referral administration.",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "CareRelay synthetic referral clarity demonstration",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "CareRelay · Referral clarity, one step at a time",
      description:
        "An independent synthetic demonstration for evidence-backed referral administration.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
