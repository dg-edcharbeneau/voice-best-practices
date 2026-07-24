# React + CopilotKit — Voice-Driven CopilotChat

The realtime voice UI from [`../reactjs`](../reactjs) — start/stop, voice-activity
feedback, turn-taking, and barge-in — wired to **[CopilotKit](https://github.com/CopilotKit/CopilotKit)**'s
[`CopilotChat`](https://docs.copilotkit.ai) component and a real LLM. For the *why*
behind every voice behavior, read the shared guide:
[**BEST_PRACTICES.md**](../../BEST_PRACTICES.md).

> This is where the `respond` seam from the other examples becomes a real brain.
> Instead of echoing your turn, each finished turn is sent to an LLM through the
> CopilotKit runtime, and the answer is spoken back.

## The idea: split the job cleanly

| Role | Owner |
|---|---|
| **Ears** — streaming STT, turn detection (Flux) | Deepgram |
| **Mouth** — streaming TTS, gap-free playback, barge-in | Deepgram |
| **Brain** — the LLM that answers | CopilotKit runtime → OpenAI |
| **Chat UI** — the visible, typeable conversation | CopilotKit `<CopilotChat>` |

Deepgram handles everything realtime and audio; CopilotKit handles the model
call and renders the running conversation. Because the input is just text by the
time a turn is committed, **you can also type** into the chat — it's the same
conversation either way.

## How it flows

```
 mic ─▶ Flux STT ─▶ EndOfTurn ─▶ appendMessage(user)
                                      │
                                      ▼
                         CopilotKit runtime ─▶ LLM
                                      │  (streams reply)
                                      ▼
        Deepgram TTS ◀── assistant reply ◀── <CopilotChat> renders it
             │
             ▼
        gap-free playback  ──(user speaks / "Stop speaking")──▶ barge-in:
                                                 flush audio + stopGeneration()
```

## How it maps to React

The realtime machinery is **framework-agnostic** and shared, almost verbatim,
with the vanilla and React examples — capture, sockets, playback, and the state
machine are plain modules under [`src/lib/`](src/lib/). CopilotKit lives only at
the edges.

| Concern | Where it lives |
|---|---|
| State machine (idle → connecting → listening → thinking → speaking) | [`src/lib/conversation.js`](src/lib/conversation.js) |
| Mic / STT / TTS / player / token / config | [`src/lib/`](src/lib/) (unchanged from vanilla) |
| React seam — callbacks → state, one instance, teardown | [`src/hooks/useConversation.js`](src/hooks/useConversation.js) |
| **Voice ⇄ CopilotChat bridge** — `respond` + barge-in `stopGeneration` | [`src/hooks/useCopilotVoiceBridge.js`](src/hooks/useCopilotVoiceBridge.js) |
| **CopilotKit runtime** (holds the LLM key, relays to OpenAI) | [`server/server.mjs`](server/server.mjs) |
| UI — voice HUD + `<CopilotChat>` | [`src/App.jsx`](src/App.jsx), [`src/components/`](src/components/) |
| **Custom chat input** — textarea + Listen / Barge-in / Send buttons in one box | [`src/components/VoiceInput.jsx`](src/components/VoiceInput.jsx) (passed to `<CopilotChat Input={…} />`) |

The only change to the shared orchestrator is one integration seam,
`onResponseInterrupted`: because the "brain" is now a remote LLM streaming a
reply, barge-in has to stop **generation** as well as audio. Everything else in
[`conversation.js`](src/lib/conversation.js) is identical to the plain examples.

### The bridge, in one paragraph

[`useCopilotVoiceBridge`](src/hooks/useCopilotVoiceBridge.js) uses CopilotKit's
chat hook to expose two functions to the voice orchestrator: `respond(text)`
calls `appendMessage(...)` and resolves with the assistant's reply once
generation settles (via a render-driven effect that watches the `messages` list,
so it's race-free — not by reading state the instant a promise resolves);
`onResponseInterrupted()` calls `stopGeneration()` on barge-in. That's the whole
integration.

> **Version note:** we read the chat via `useCopilotChatInternal` rather than the
> public `useCopilotChat`, because in CopilotKit `1.63.x` the public wrapper
> returns `undefined` for `visibleMessages` (it was renamed `messages`
> internally). See the comment at the top of the bridge for details.

### Controls inside the chat input

The Listen / Barge-in / Send buttons live in the chat input itself, via
`<CopilotChat Input={VoiceInput} />` — CopilotKit lets you replace the default
input with your own component ([`InputProps`](src/components/VoiceInput.jsx) gives
you `onSend`, `inProgress`, `onStop`). Because CopilotKit renders that component,
props can't reach it, so the voice controls are handed down through a small
[context](src/hooks/voiceControls.jsx). The input is a *stable* module-scope
component (not recreated per render) so CopilotChat never remounts it — otherwise
you'd lose focus and half-typed text.

## Quick start

Requires **Node 18+**, a Deepgram API key ([console.deepgram.com](https://console.deepgram.com)),
and an OpenAI API key ([platform.openai.com](https://platform.openai.com)).

```sh
npm install
cp .env.example .env      # then set DEEPGRAM_API_KEY and OPENAI_API_KEY
npm run dev
```

`npm run dev` runs two processes via `concurrently`:

- **server** (`:3000`) — the Node server: `/api/token` (Deepgram) **and**
  `/api/copilotkit` (the CopilotKit runtime). Holds both keys.
- **client** (`:5173`) — Vite dev server; proxies `/api/*` to the server.

Open **http://localhost:5173**, click **Start listening**, allow the mic, and
speak. Pause, and the LLM answers out loud. Talk over it — or click **Stop
speaking** — to barge in (which also stops the model). You can type in the chat
box at any time.

> Use `http://localhost` (or https). Microphone capture is blocked on insecure
> origins.

## Production

```sh
npm run build     # emits ./dist
npm start         # build + serve ./dist, /api/token, and /api/copilotkit on :3000
```

In production there's no proxy: the Node server serves the built app **and**
both API endpoints from the same origin.

## Keys never touch the browser

Best practice #1 applies to **both** providers:

- The **Deepgram** key mints short-lived browser tokens; the browser opens
  STT/TTS WebSockets directly with those tokens.
- The **OpenAI** key stays in the CopilotKit runtime on the server; the browser
  talks to the LLM only through `/api/copilotkit`.

`grep -ri "OPENAI_API_KEY\|DEEPGRAM_API_KEY" src/` returns nothing.

## Swapping the LLM provider

The provider is one line in [`server/server.mjs`](server/server.mjs). CopilotKit
ships adapters for OpenAI, Anthropic, Google, Groq, and more — all exported from
`@copilotkit/runtime`. For Anthropic:

```sh
npm install @anthropic-ai/sdk
```

```js
import { CopilotRuntime, AnthropicAdapter, copilotRuntimeNodeHttpEndpoint }
  from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const serviceAdapter = new AnthropicAdapter({ anthropic, model: "claude-sonnet-4-20250514" });
```

## Make the assistant *do* things

Right now the LLM only talks. CopilotKit's real power is letting it **act**: add
[`useCopilotAction`](https://docs.copilotkit.ai) hooks in the React app to
register frontend functions the model can call, and
[`useCopilotReadable`](https://docs.copilotkit.ai) to expose app state to it. The
voice loop doesn't change — you're just giving the brain hands.

## Streaming TTS (optional upgrade)

This example speaks each reply once generation **completes**, which keeps the
bridge simple. To start speaking sooner, watch the in-progress assistant message
in the `messages` list and feed new sentence-sized chunks into `tts.speak()` as
they stream (Best practice #11). The capture / turn-taking / barge-in / playback
machinery stays the same.
