// useConversation — the React seam over the framework-agnostic orchestrator.
//
// The state machine (idle → connecting → listening → thinking → speaking) lives
// in ../lib/conversation.js. This hook does only the React-specific work: it
// wires the orchestrator's callbacks to React state, keeps ONE instance for the
// component's lifetime, forwards the currently-selected language, and tears the
// session down on unmount (Best practice #8).
//
// Two of the orchestrator's seams come from the chat "brain" (useChat):
//   • respond(text, onChunk)   → send the spoken turn to the brain, stream the reply
//   • onResponseInterrupted()  → stop the brain when the user barges in
// Both are passed in as props. They can change between renders, so we hold them
// in refs and call through stable trampolines — the orchestrator is created ONCE
// and never sees a stale closure.

import { useCallback, useEffect, useRef, useState } from "react";
import { createConversation } from "../lib/conversation.js";
import { friendlyError, preflight } from "../lib/preflight.js";
import { DEFAULT_LANGUAGE, VOICE_PICKER_LANGUAGE, getVoiceConfig } from "../lib/config.js";

const EMPTY_TRANSCRIPT = { committed: [], interim: "" };

export function useConversation({
  respond,
  onResponseInterrupted,
  language = DEFAULT_LANGUAGE,
} = {}) {
  const [state, setState] = useState("idle");
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  const [level, setLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [error, setError] = useState(null);
  // The picked voice, which only applies to English — the Flux TTS catalogue is
  // English-only, so every other language uses the Aura-2 voice from the table.
  // Seeded from that table so the picker opens on the real current voice.
  const [voice, setVoiceState] = useState(
    () => getVoiceConfig(VOICE_PICKER_LANGUAGE).tts.model
  );

  // Keep the latest prop callbacks + language in refs so the orchestrator's
  // stable trampolines always reach the current implementations.
  const respondRef = useRef(respond);
  respondRef.current = respond;
  const interruptedRef = useRef(onResponseInterrupted);
  interruptedRef.current = onResponseInterrupted;
  const languageRef = useRef(language);
  languageRef.current = language;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // The voice override is meaningful for English only; for other languages the
  // language itself decides the voice, so pass nothing and let the table win.
  const voiceFor = (lang) =>
    lang === VOICE_PICKER_LANGUAGE ? voiceRef.current : null;

  // Create exactly one orchestrator. State setters are stable, so the callbacks
  // below never go stale — no need to recreate the instance on re-render.
  const convoRef = useRef(null);
  if (convoRef.current === null) {
    convoRef.current = createConversation({
      language,
      respond: (text, onChunk) =>
        respondRef.current ? respondRef.current(text, onChunk) : text,
      onResponseInterrupted: () => interruptedRef.current?.(),
      onState: (s) => setState(s),
      onLevel: (l) => setLevel(l),
      onOutputLevel: (l) => setOutputLevel(l),
      onTranscript: ({ interim, committed }) => {
        if (committed) {
          const text = interim.trim();
          setTranscript((prev) => ({
            committed: text ? [...prev.committed, text] : prev.committed,
            interim: "",
          }));
        } else {
          setTranscript((prev) => ({ ...prev, interim }));
        }
      },
      onError: (err) => {
        console.error(err);
        setError(friendlyError(err));
      },
    });
  }

  // One-time environment check. If the browser can't run the demo, surface it
  // and flip to the error state (Start stays clickable so the user can retry
  // after fixing permissions).
  useEffect(() => {
    const blocker = preflight();
    if (blocker) {
      setError(blocker);
      setState("error");
    }
  }, []);

  // Full teardown when the component unmounts.
  useEffect(() => {
    const convo = convoRef.current;
    return () => convo?.stop();
  }, []);

  const start = useCallback(() => {
    setError(null);
    setTranscript(EMPTY_TRANSCRIPT);
    convoRef.current?.start(languageRef.current, voiceFor(languageRef.current));
  }, []);

  const stop = useCallback(() => convoRef.current?.stop(), []);

  // Reconnect on new models. Used for both knobs that can't change on a live
  // socket — the language (STT model + voice) and the TTS voice itself. No-op
  // reconnect if a session isn't running; the next start() picks the refs up.
  const restart = useCallback(async (nextLanguage, nextVoice) => {
    const convo = convoRef.current;
    if (!convo) return;
    const wasRunning = convo.state !== "idle" && convo.state !== "error";
    if (wasRunning) {
      await convo.stop();
      setTranscript(EMPTY_TRANSCRIPT);
      setError(null);
      convo.start(nextLanguage, nextVoice);
    }
  }, []);

  // Switch language mid-session.
  const restartWith = useCallback(
    (nextLanguage) => {
      languageRef.current = nextLanguage;
      return restart(nextLanguage, voiceFor(nextLanguage));
    },
    [restart]
  );

  // Switch the TTS voice mid-session. Flux TTS can only change `speed`
  // mid-stream via Configure, not the voice, so this needs a fresh socket.
  // That also drops Flux's cross-turn context — an unavoidable cost here, since
  // the new voice is a different voice anyway. It's the reason we don't
  // reconnect for any *other* reason; see tts.js.
  const changeVoice = useCallback(
    (nextVoice) => {
      voiceRef.current = nextVoice;
      setVoiceState(nextVoice);
      return restart(languageRef.current, voiceFor(languageRef.current));
    },
    [restart]
  );

  // Click-driven barge-in: stop the current response without ending the session.
  const interruptResponse = useCallback(
    () => convoRef.current?.interruptResponse(),
    []
  );

  return {
    state,
    transcript,
    level,
    outputLevel,
    error,
    voice,
    start,
    stop,
    restartWith,
    changeVoice,
    interruptResponse,
  };
}
