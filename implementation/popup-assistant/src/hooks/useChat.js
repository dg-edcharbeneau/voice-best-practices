// useChat — the "brain" and the message store for the shadcn chat UI.
//
// This is the shadcn example's replacement for the CopilotKit bridge. Where the
// CopilotKit example delegated the LLM call AND the message rendering to
// <CopilotChat>, here WE own both: this hook holds the message list (rendered by
// our own shadcn components) and streams replies from our /api/chat endpoint.
//
// It exposes the two seams the voice orchestrator needs (see
// ../lib/conversation.js):
//   • respond(text)            — a spoken turn ended; send it to the LLM and
//                                resolve with the full reply (so it can be spoken)
//   • onResponseInterrupted()  — the user barged in; abort the in-flight request
//                                so the LLM stops generating (Best practice #4)
//
// Typed messages go through sendTyped(): same streaming into the message list,
// but the reply is NOT spoken (you typed, so you're reading — mirrors the
// CopilotKit example, where only spoken turns are routed to TTS).

import { useCallback, useRef, useState } from "react";

let idSeq = 0;
const nextId = () => `m${++idSeq}`;

const GREETING = {
  id: nextId(),
  role: "assistant",
  content: "Hi! Press Listen and just talk to me — or type below.",
};

export function useChat() {
  const [messages, setMessages] = useState([GREETING]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Latest messages, readable from inside the stable callbacks below without
  // making them depend on (and churn with) the message list.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // The AbortController for the request currently streaming (null when idle).
  const abortRef = useRef(null);

  // Core completion: append the user's message + an empty assistant placeholder,
  // POST the history to /api/chat, and stream the reply into the placeholder.
  // Resolves with the full reply text. `onChunk`, when provided, is called with
  // each streamed piece of text as it arrives — the voice orchestrator uses it
  // to start speaking sentence-by-sentence instead of waiting for the full reply.
  const complete = useCallback(async (userText, onChunk) => {
    const clean = (userText ?? "").trim();
    if (!clean) return "";

    const userMsg = { id: nextId(), role: "user", content: clean };
    const assistantId = nextId();

    // History to send = everything so far PLUS this new user turn.
    const history = [...messagesRef.current, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setIsGenerating(true);

    const ac = new AbortController();
    abortRef.current = ac;
    let full = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed (${res.status})`);
      }

      // Stream the reply, appending tokens to the live assistant bubble so the UI
      // "types" the answer as it arrives (modern-chat feel).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (!text) continue;
        full += text;
        // Feed TTS as we go so audio can start on the first finished sentence.
        onChunk?.(text);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m))
        );
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        // Barge-in / stop: keep whatever streamed so far and move on quietly.
      } else {
        console.error(err);
        // Surface the failure inside the assistant bubble rather than leaving it
        // blank (Best practice #10 — errors visible in the UI).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || "Sorry — I couldn't reach the model.",
                  error: true,
                }
              : m
          )
        );
        throw err;
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setIsGenerating(false);
    }

    return full;
  }, []);

  // Voice seam: the orchestrator awaits this on EndOfTurn and speaks the reply
  // as it streams (onChunk), so audio begins on the first finished sentence.
  const respond = useCallback((text, onChunk) => complete(text, onChunk), [complete]);

  // Typed seam: stream into the list, but don't return anything to speak.
  const sendTyped = useCallback(
    (text) => {
      complete(text).catch(() => {});
    },
    [complete]
  );

  // Barge-in / stop generating: abort the streaming request. The upstream LLM
  // call is aborted server-side when the socket closes (see server/server.mjs).
  const onResponseInterrupted = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([{ ...GREETING, id: nextId() }]);
  }, []);

  return {
    messages,
    isGenerating,
    respond,
    sendTyped,
    onResponseInterrupted,
    reset,
  };
}
