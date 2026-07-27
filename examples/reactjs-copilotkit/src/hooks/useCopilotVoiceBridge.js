// useCopilotVoiceBridge — the glue between the voice loop and <CopilotChat>.
//
// The division of labor in this example:
//   • Deepgram is the EARS and MOUTH — streaming STT (Flux) with turn detection,
//     and streaming TTS with gap-free playback and barge-in.
//   • CopilotKit is the BRAIN and the visible CHAT — its runtime relays to the
//     LLM, and <CopilotChat> renders the running conversation (typed *or* spoken).
//
// This hook exposes the two seams the voice orchestrator needs (see
// ../lib/conversation.js):
//   • respond(text, onChunk)   — a spoken turn ended; send it to the LLM,
//                                stream the reply out through onChunk as it
//                                generates, and resolve with the full reply
//   • onResponseInterrupted()  — the user barged in; stop the LLM immediately
//
// Why an observer effect instead of just awaiting `appendMessage`? `appendMessage`
// resolves when the run completes, but the reply text lands in React state (the
// message list). Reading that state the instant the promise resolves is racy —
// the component may not have re-rendered yet. So `respond` returns a promise that
// a render-driven effect settles once generation is done and the new assistant
// message is actually present. The same effect also watches the in-progress
// assistant message grow and emits each new slice through onChunk, so the voice
// orchestrator can start speaking on the first finished sentence instead of
// waiting for the whole reply. Race-free by construction.
//
// ── CopilotKit version note (1.63.x) ────────────────────────────────────────
// We read the chat through `useCopilotChatInternal`, not `useCopilotChat`. In
// 1.63.x the public `useCopilotChat` still destructures a `visibleMessages` key
// that the internal hook no longer returns (it was renamed to `messages`), so
// `useCopilotChat().visibleMessages` is `undefined` — and calling `.map` on it
// throws "Cannot read properties of undefined". `useCopilotChatInternal` is
// exported and returns the working `messages` array (AG-UI format) alongside
// `appendMessage` / `isLoading` / `stopGeneration`.

import { useCallback, useEffect, useRef } from "react";
import { useCopilotChatInternal } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";

// AG-UI message helpers. Messages are plain objects: { id, role, content, … }.
// A finished assistant text reply has role "assistant" and a non-empty string
// `content` (tool-call messages carry a `toolCalls` array instead).
const isAssistantText = (m) =>
  m?.role === "assistant" && typeof m.content === "string" && m.content.trim();

export function useCopilotVoiceBridge() {
  // The lightweight, open-source-friendly chat surface (no public license key
  // needed). We use the *internal* hook because the public wrapper's
  // `visibleMessages` is broken in 1.63.x (see note above).
  const { messages, appendMessage, isLoading, stopGeneration } =
    useCopilotChatInternal();

  // Latest chat values, readable from inside the stable callbacks below.
  const chatRef = useRef(null);
  chatRef.current = { appendMessage, messages, stopGeneration };

  // The single spoken turn awaiting a reply: { resolve, beforeIds }.
  const pending = useRef(null);

  const settle = useCallback((text) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    p.resolve(text);
  }, []);

  // respond(): the orchestrator calls this when Flux commits a finished turn.
  // onChunk receives each new slice of the reply as it streams.
  const respond = useCallback((userText, onChunk) => {
    const { appendMessage, messages } = chatRef.current;
    // Remember which messages already exist so we can spot the *new* reply.
    const beforeIds = new Set((messages ?? []).map((m) => m.id));
    return new Promise((resolve, reject) => {
      // `emitted` tracks how many characters of the reply we've already streamed
      // to onChunk, so each render only forwards the newly-arrived tail.
      pending.current = { resolve, beforeIds, onChunk, emitted: 0 };
      appendMessage(
        new TextMessage({ role: Role.User, content: userText })
      ).catch((err) => {
        if (pending.current) {
          pending.current = null;
          reject(err);
        }
      });
    });
  }, []);

  // onResponseInterrupted(): barge-in. Stop the LLM mid-generation and unblock the
  // pending respond() — the orchestrator has already moved on, so the empty reply
  // is dropped by its turn-index guard.
  const onResponseInterrupted = useCallback(() => {
    chatRef.current.stopGeneration?.();
    settle("");
  }, [settle]);

  // cancelPending(): called when the voice session fully stops, so a reply that
  // was still in flight doesn't leave respond() hanging forever.
  const cancelPending = useCallback(() => settle(""), [settle]);

  // Render-driven observer: stream the in-progress reply out through onChunk as
  // it grows, then hand the full reply to whoever is awaiting respond() once
  // generation settles.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    // The new assistant message for this turn — tracked even while it's still
    // streaming (and possibly empty) so we can forward each token delta.
    const msg = [...(messages ?? [])]
      .reverse()
      .find(
        (m) =>
          m?.role === "assistant" &&
          typeof m.content === "string" &&
          !p.beforeIds.has(m.id)
      );
    if (msg && msg.content.length > p.emitted) {
      p.onChunk?.(msg.content.slice(p.emitted));
      p.emitted = msg.content.length;
    }
    // Generation finished: resolve with the full reply. The orchestrator has
    // already spoken the streamed chunks, so this return value is just the
    // fallback for a non-streaming path.
    if (!isLoading && isAssistantText(msg)) settle(msg.content);
  }, [messages, isLoading, settle]);

  return { respond, onResponseInterrupted, cancelPending };
}
