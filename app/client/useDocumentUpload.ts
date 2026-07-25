"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Fixture } from "@/lib/fixtures";
import {
  verifyDocumentResponse,
  type UploadCitation,
  type VerifiedDocumentResponse,
} from "./document-response";

export type UploadState = "idle" | "analysing" | "ready" | "error";

type UploadSnapshot = {
  citations: UploadCitation[];
  message: string;
  stages: string[];
  state: UploadState;
};

type UseDocumentUploadOptions = {
  fixture: Fixture;
  onBegin: () => void;
  onRejected: () => void;
  onVerified: (document: VerifiedDocumentResponse) => void;
};

const INITIAL_UPLOAD: UploadSnapshot = {
  citations: [],
  message: "Ready for a synthetic document",
  stages: [],
  state: "idle",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseError(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return typeof payload.message === "string" ? payload.message : "";
}

export function useDocumentUpload({
  fixture,
  onBegin,
  onRejected,
  onVerified,
}: UseDocumentUploadOptions) {
  const [snapshot, setSnapshot] = useState<UploadSnapshot>(INITIAL_UPLOAD);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);

  const cancelPending = useCallback((message: string) => {
    if (!busyRef.current) return;
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    busyRef.current = false;
    setSnapshot({
      citations: [],
      stages: [],
      state: "idle",
      message,
    });
  }, []);

  const resetUpload = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    busyRef.current = false;
    setSnapshot(INITIAL_UPLOAD);
  }, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      busyRef.current = false;
    },
    [],
  );

  const runUpload = useCallback(
    async (
      resolveFile: (signal: AbortSignal) => Promise<File>,
    ): Promise<void> => {
      if (busyRef.current) {
        setSnapshot((current) => ({
          ...current,
          message:
            "Please wait for the current synthetic document check to finish.",
        }));
        return;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const controller = new AbortController();
      controllerRef.current = controller;
      busyRef.current = true;
      onBegin();
      setSnapshot({
        citations: [],
        stages: [],
        state: "analysing",
        message: "Validating and extracting the document in this request",
      });

      try {
        const file = await resolveFile(controller.signal);
        if (generation !== generationRef.current) return;
        const formData = new FormData();
        formData.append("document", file);
        const response = await fetch("/api/documents", {
          method: "POST",
          body: formData,
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (generation !== generationRef.current) return;
        if (!response.ok) {
          throw new Error(
            responseError(payload) || "The document did not match the fixture.",
          );
        }
        const verified = verifyDocumentResponse(payload, fixture);
        if (!verified) {
          throw new Error(
            "The verification response was incomplete, so verified state was not shown.",
          );
        }
        setSnapshot({
          citations: verified.citations,
          stages: verified.stages,
          state: "ready",
          message: "Exact supplied PDF verified.",
        });
        onVerified(verified);
      } catch (error) {
        if (generation !== generationRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setSnapshot({
            citations: [],
            stages: [],
            state: "idle",
            message: "Document check cancelled.",
          });
          return;
        }
        onRejected();
        setSnapshot({
          citations: [],
          stages: [],
          state: "error",
          message:
            error instanceof Error && error.message
              ? `Document not accepted. ${error.message}`
              : "Document not accepted. Use only the exact supplied synthetic PDF.",
        });
      } finally {
        if (generation === generationRef.current) {
          busyRef.current = false;
          controllerRef.current = null;
        }
      }
    },
    [fixture, onBegin, onRejected, onVerified],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      await runUpload(async () => file);
    },
    [runUpload],
  );

  const loadBundledPdf = useCallback(async () => {
    await runUpload(async (signal) => {
      const response = await fetch(
        "/demo/rheumatology-referral-synthetic.pdf",
        { cache: "no-store", signal },
      );
      if (!response.ok) {
        throw new Error("The bundled test PDF could not be loaded.");
      }
      const blob = await response.blob();
      return new File(
        [blob],
        "rheumatology-referral-synthetic.pdf",
        { type: "application/pdf" },
      );
    });
  }, [runUpload]);

  return {
    ...snapshot,
    busy: snapshot.state === "analysing",
    cancelPending,
    loadBundledPdf,
    resetUpload,
    uploadFile,
  };
}
