"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FixtureId } from "@/lib/fixtures";
import { acquireCapability } from "./capability";

type SpeechLanguage = "en-GB" | "cy-GB" | "pl-PL";

type SpeechRecognitionEventLike = {
  results: {
    [index: number]: {
      [index: number]: { transcript: string };
    };
  };
};

type SpeechRecognitionLike = {
  abort?: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop?: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type UseVoiceControlsOptions = {
  allowed: boolean;
  answerLanguage: SpeechLanguage;
  answerText: string;
  elevenLabsReady: boolean;
  fixtureId: FixtureId;
  onTranscript: (transcript: string) => void;
  onUnsupported: () => void;
};

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const APPROVED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
]);

const APPROVED_VISIBLE_SPEECH: Record<
  string,
  {
    fixtureId: FixtureId;
    language: SpeechLanguage;
    text: string;
  }
> = {
  "rheumatology-plain": {
    fixtureId: "rheumatology",
    language: "en-GB",
    text: "The rheumatology team received the synthetic referral. It has not been accepted and no appointment has been booked. Contact the referral team and quote C R R H E four one zero one.",
  },
  "rheumatology-cy": {
    fixtureId: "rheumatology",
    language: "cy-GB",
    text: "Mae'r tîm rhiwmatoleg wedi cael yr atgyfeiriad synthetig. Nid yw wedi'i dderbyn ac nid oes apwyntiad wedi'i drefnu.",
  },
  "rheumatology-pl": {
    fixtureId: "rheumatology",
    language: "pl-PL",
    text: "Zespół reumatologii otrzymał syntetyczne skierowanie. Nie zostało ono przyjęte i nie umówiono wizyty.",
  },
  "diabetes-plain": {
    fixtureId: "diabetes",
    language: "en-GB",
    text: "The synthetic diabetes clinic appointment is booked for Wednesday 5 August 2026 at 10:20. Arrive at 10:10.",
  },
  "cardiology-plain": {
    fixtureId: "cardiology",
    language: "en-GB",
    text: "The synthetic cardiology referral is waiting for a copy of an existing record. Ask the GP practice whether the copy was sent. This is not a request to arrange a new test.",
  },
};

function approvedSpeechId(
  fixtureId: FixtureId,
  language: SpeechLanguage,
  text: string,
): string | null {
  const match = Object.entries(APPROVED_VISIBLE_SPEECH).find(
    ([, item]) =>
      item.fixtureId === fixtureId &&
      item.language === language &&
      item.text === text,
  );
  return match?.[0] ?? null;
}

export function useVoiceControls({
  allowed,
  answerLanguage,
  answerText,
  elevenLabsReady,
  fixtureId,
  onTranscript,
  onUnsupported,
}: UseVoiceControlsOptions) {
  const [isListening, setIsListening] = useState(false);
  const [message, setMessage] = useState("");
  const generationRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const providerControllerRef = useRef<AbortController | null>(null);

  const stopExternalMedia = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      if (recognition.abort) recognition.abort();
      else recognition.stop?.();
    }
    recognitionRef.current = null;
    providerControllerRef.current?.abort();
    providerControllerRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const cancelVoice = useCallback(
    (nextMessage = "") => {
      generationRef.current += 1;
      stopExternalMedia();
      setIsListening(false);
      setMessage(nextMessage);
    },
    [stopExternalMedia],
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      stopExternalMedia();
    },
    [stopExternalMedia],
  );

  const startVoiceInput = useCallback(() => {
    cancelVoice();
    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition =
      browserWindow.SpeechRecognition ??
      browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage(
        "Voice input is not supported here. Type your question instead.",
      );
      onUnsupported();
      return;
    }

    const generation = generationRef.current;
    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = "en-GB";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        if (generation !== generationRef.current) return;
        const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
        if (!transcript) {
          setMessage("No transcript was captured. No question was sent.");
          return;
        }
        onTranscript(transcript);
        setMessage("Transcript captured. Review it before sending.");
      };
      recognition.onerror = () => {
        if (generation !== generationRef.current) return;
        recognitionRef.current = null;
        setIsListening(false);
        setMessage("Voice recognition failed. No question was sent.");
      };
      recognition.onend = () => {
        if (generation !== generationRef.current) return;
        recognitionRef.current = null;
        setIsListening(false);
      };
      setIsListening(true);
      setMessage("Listening for one synthetic referral question…");
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setMessage("Voice recognition could not start. No question was sent.");
    }
  }, [cancelVoice, onTranscript, onUnsupported]);

  const speakWithDevice = useCallback(
    (text: string, language: SpeechLanguage) => {
      if (!("speechSynthesis" in window)) {
        setMessage("Speech output is unavailable on this device.");
        return;
      }
      window.speechSynthesis.cancel();
      const generation = generationRef.current;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.onend = () => {
        if (generation !== generationRef.current) return;
        setMessage("Device speech finished. Nothing was recorded.");
      };
      utterance.onerror = () => {
        if (generation !== generationRef.current) return;
        setMessage("Device speech could not finish.");
      };
      window.speechSynthesis.speak(utterance);
      setMessage("Playing the visible answer with device speech.");
    },
    [],
  );

  const listenToAnswer = useCallback(async () => {
    if (!allowed) {
      setMessage("Voice output is off in Settings.");
      return;
    }
    if (!answerText.trim()) {
      setMessage("There is no visible answer to read.");
      return;
    }

    cancelVoice();
    const generation = generationRef.current;
    const speechId = elevenLabsReady
      ? approvedSpeechId(fixtureId, answerLanguage, answerText)
      : null;
    if (!speechId) {
      speakWithDevice(answerText, answerLanguage);
      return;
    }

    const controller = new AbortController();
    providerControllerRef.current = controller;
    try {
      const capability = await acquireCapability(
        "elevenlabs",
        controller.signal,
      );
      if (generation !== generationRef.current) return;
      if (!capability) {
        setMessage(
          "Provider speech permission was unavailable. Using device speech.",
        );
        speakWithDevice(answerText, answerLanguage);
        return;
      }
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: {
          Accept: "audio/mpeg, audio/*",
          "Content-Type": "application/json",
          "X-CareRelay-Capability": capability,
        },
        body: JSON.stringify({ fixtureId, speechId }),
        signal: controller.signal,
      });
      if (generation !== generationRef.current) return;
      const mediaType =
        response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() ?? "";
      const contentLengthHeader = response.headers.get("content-length");
      const contentLength =
        contentLengthHeader === null ? null : Number(contentLengthHeader);
      if (
        !response.ok ||
        !APPROVED_AUDIO_TYPES.has(mediaType) ||
        (contentLength !== null &&
          (!/^\d+$/u.test(contentLengthHeader ?? "") ||
            !Number.isFinite(contentLength) ||
            contentLength < 1 ||
            contentLength > MAX_AUDIO_BYTES))
      ) {
        throw new Error("Provider speech response was not usable.");
      }
      const blob = await response.blob();
      if (blob.size < 1 || blob.size > MAX_AUDIO_BYTES) {
        throw new Error("Provider speech response was not usable.");
      }
      if (generation !== generationRef.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (generation !== generationRef.current) return;
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        audioRef.current = null;
        setMessage("Approved synthetic speech finished.");
      };
      audio.onerror = () => {
        if (generation !== generationRef.current) return;
        cancelVoice("Provider speech was unavailable. Using device speech.");
        speakWithDevice(answerText, answerLanguage);
      };
      await audio.play();
      setMessage("Playing the exact visible approved answer.");
    } catch (error) {
      if (generation !== generationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      cancelVoice("Provider speech was unavailable. Using device speech.");
      speakWithDevice(answerText, answerLanguage);
    } finally {
      if (generation === generationRef.current) {
        providerControllerRef.current = null;
      }
    }
  }, [
    allowed,
    answerLanguage,
    answerText,
    cancelVoice,
    elevenLabsReady,
    fixtureId,
    speakWithDevice,
  ]);

  return {
    cancelVoice,
    isListening,
    listenToAnswer,
    message,
    startVoiceInput,
  };
}
