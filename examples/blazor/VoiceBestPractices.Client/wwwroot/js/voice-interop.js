// JS-isolation bridge between the framework-agnostic conversation orchestrator
// and .NET. This is the ONE module Blazor imports (via
// IJSRuntime.InvokeAsync<IJSObjectReference>("import", "./js/voice-interop.js")).
// Nothing here is attached to `window` — it is an ES module loaded in isolation,
// which is exactly what "JS isolation" means in Blazor.
//
// Responsibilities (the "edge" the framework owns — see ConversationInterop.cs):
//   1. create the orchestrator and relay its callbacks up to .NET,
//   2. expose start / stop / interruptResponse for .NET to call down,
//   3. run browser-capability preflight (secure context, getUserMedia, worklet).
//
// The orchestrator (conversation.js) is unchanged and unaware of .NET.

import { createConversation } from "./conversation.js";
import { echoResponder, llmResponder } from "./respond.js";
import { logDiagnostic } from "./diagnostics.js";

// The "brain". `echoResponder` (the default) speaks your finished turn back so the
// full realtime loop runs with no LLM configured. Switch to `llmResponder` to route
// turns through the server-side /api/chat endpoint (streamed + barge-in-cancellable).
// Requires an LLM configured on the server (OpenAI:ApiKey) — see the README.
const respond = echoResponder;

// .NET [JSInvokable] method names live in one place so a typo can't silently
// break a callback at runtime (use-js-interop best practice).
const ON_STATE = "OnStateChanged";
const ON_TRANSCRIPT = "OnTranscript";
const ON_LEVEL = "OnLevel";
const ON_ERROR = "OnError";
const ON_DIAGNOSTIC = "OnDiagnostic";

// The mic level arrives ~90×/second from the audio worklet. Forwarding every
// one across the interop boundary would re-render the Blazor component tree far
// more often than a decorative meter needs. Throttle to ~20 Hz — smooth to the
// eye, cheap on the boundary.
const LEVEL_INTERVAL_MS = 50;

class ConversationBridge {
  #dotNet;
  #convo;
  #lastLevelAt = 0;

  constructor(dotNetRef) {
    this.#dotNet = dotNetRef;
    this.#convo = createConversation({
      respond,
      onState: (state) => this.#invoke(ON_STATE, state),
      onTranscript: ({ interim, committed }) =>
        this.#invoke(ON_TRANSCRIPT, { interim, committed }),
      onLevel: (level) => {
        const now = performance.now();
        if (now - this.#lastLevelAt < LEVEL_INTERVAL_MS) return;
        this.#lastLevelAt = now;
        this.#invoke(ON_LEVEL, level);
      },
      onError: (err) =>
        this.#invoke(ON_ERROR, { name: err?.name ?? "", message: err?.message ?? String(err) }),
      // Turn-taking / barge-in trace. Mirrored to the console here (the browser
      // console is a JS concern), then relayed to .NET for the Diagnostics
      // panel. Unlike the mic level this needs no throttle: it's a handful of
      // rows per turn, and every one of them matters.
      onDiagnostic: (evt) => {
        logDiagnostic(evt);
        this.#invoke(ON_DIAGNOSTIC, evt);
      },
    });
  }

  // Every call into .NET can throw if the app is being torn down; swallow it so
  // a late audio/turn callback can't crash the session.
  async #invoke(method, arg) {
    try {
      await this.#dotNet.invokeMethodAsync(method, arg);
    } catch {
      /* component disposed mid-callback — ignore */
    }
  }

  start() {
    return this.#convo.start();
  }

  stop() {
    return this.#convo.stop();
  }

  interruptResponse() {
    this.#convo.interruptResponse();
  }
}

let bridge = null;

/** Wire up the orchestrator and its callbacks to a .NET object reference. */
export function initialize(dotNetRef) {
  bridge = new ConversationBridge(dotNetRef);
}

/**
 * Best practice #10: check the browser can actually run the demo before we let
 * the user try. Returns a human-readable blocker string, or null if all good.
 */
export function preflight() {
  if (!window.isSecureContext) {
    return "This demo needs a secure context. Open it over http://localhost or https://.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser doesn't support microphone capture (getUserMedia).";
  }
  if (typeof AudioWorkletNode === "undefined") {
    return "This browser doesn't support AudioWorklet.";
  }
  return null;
}

export function start() {
  return bridge?.start();
}

export function stop() {
  return bridge?.stop();
}

export function interruptResponse() {
  bridge?.interruptResponse();
}

/** Full teardown: stop the session and drop the instance. */
export async function dispose() {
  await bridge?.stop();
  bridge = null;
}
