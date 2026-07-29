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
import { DEFAULT_LANGUAGE } from "../lib/config.js";

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

  // Keep the latest prop callbacks + language in refs so the orchestrator's
  // stable trampolines always reach the current implementations.
  const respondRef = useRef(respond);
  respondRef.current = respond;
  const interruptedRef = useRef(onResponseInterrupted);
  interruptedRef.current = onResponseInterrupted;
  const languageRef = useRef(language);
  languageRef.current = language;

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
    convoRef.current?.start(languageRef.current);
  }, []);

  const stop = useCallback(() => convoRef.current?.stop(), []);

  // Switch language mid-session: tear down and reconnect on the new models.
  // No-op reconnect if a session isn't running — the next start() picks up the
  // new language from languageRef.
  const restartWith = useCallback(async (nextLanguage) => {
    languageRef.current = nextLanguage;
    const convo = convoRef.current;
    if (!convo) return;
    const wasRunning = convo.state !== "idle" && convo.state !== "error";
    if (wasRunning) {
      await convo.stop();
      setTranscript(EMPTY_TRANSCRIPT);
      setError(null);
      convo.start(nextLanguage);
    }
  }, []);

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
    start,
    stop,
    restartWith,
    interruptResponse,
  };
}
