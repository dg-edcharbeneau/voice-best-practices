# React — Voice UI Best Practices

The same realtime voice UI as [`../basic-html-js`](../basic-html-js) — start/stop,
voice-activity feedback, turn-taking, and barge-in — built with **React 19 +
Vite**. For the *why* behind every behavior, read the shared guide:
[**BEST_PRACTICES.md**](../../BEST_PRACTICES.md).

> Direct STT/TTS — **not** the Voice Agent platform. There's no LLM; the demo
> echoes you. The one-line spot where an LLM would go is the `respond` seam in
> [`src/lib/conversation.js`](src/lib/conversation.js).

## How it maps to React

The realtime machinery is **framework-agnostic** and shared verbatim with the
vanilla example — capture, sockets, playback, and the state machine are plain
modules under [`src/lib/`](src/lib/). React only owns the *edges*: turning
orchestrator callbacks into state, and rendering.

| Concern | Where it lives |
|---|---|
| State machine (idle → connecting → listening → thinking → speaking) | [`src/lib/conversation.js`](src/lib/conversation.js) |
| Mic / STT / TTS / player / token / config | [`src/lib/`](src/lib/) (unchanged from vanilla) |
| React seam — callbacks → state, one instance, teardown on unmount | [`src/hooks/useConversation.js`](src/hooks/useConversation.js) |
| UI, split into components | [`src/components/`](src/components/) |
| Turn-taking / barge-in trace (event shape + console mirror) | [`src/lib/diagnostics.js`](src/lib/diagnostics.js) |
| Audio-thread capture worklet (static asset, loaded by URL) | [`public/pcm-worklet.js`](public/pcm-worklet.js) |

### Components

- [`App.jsx`](src/App.jsx) — calls `useConversation()`, sets `data-state` on the
  root (drives all state-based CSS), and lays out the panels.
- [`StatusPanel.jsx`](src/components/StatusPanel.jsx) — composes the status row,
  mic meter, and controls.
- [`StatusIndicator.jsx`](src/components/StatusIndicator.jsx) ·
  [`MicMeter.jsx`](src/components/MicMeter.jsx) ·
  [`Controls.jsx`](src/components/Controls.jsx) ·
  [`Transcript.jsx`](src/components/Transcript.jsx) ·
  [`Diagnostics.jsx`](src/components/Diagnostics.jsx) ·
  [`ErrorBanner.jsx`](src/components/ErrorBanner.jsx)

Button enable/disable is derived purely from the machine state, so the controls
can't drift out of sync with what's actually possible.

### Diagnostics

Turn-taking and barge-in are the hardest behaviors here and the least visible —
the status label says "speaking", then it doesn't, and everything interesting
happened in between. The **Diagnostics** panel (collapsed by default, under the
transcript) makes the loop legible:

| Channel | What it shows |
|---|---|
| `turn` | every Flux `TurnInfo` event except `Update`, plus why a turn has or hasn't settled |
| `barge-in` | each cut-off: what it interrupted, `playedMs`, the abandoned turn index, and Deepgram's `SpeechInterrupted` reply (`text_spoken` / `text_remaining`) |
| `tts` | each `Speak` + `Flush` pair and its ack, so streaming granularity is visible |
| `state` | every state-machine transition |

`EndOfTurn` and `turn settled` are the two halves of turn-taking: the first ends
the *user's* turn, the second ends the *agent's*. When the UI looks stuck on
"speaking", the `not settled` rows name the exact latch holding it there
(responder still generating, flushes outstanding, or player draining).

The orchestrator emits these through one more callback (`onDiagnostic`) next to
`onState` / `onTranscript` / `onError`, so `src/lib/` stays framework-agnostic —
[`useConversation.js`](src/hooks/useConversation.js) is what turns them into
React state. Both sinks are configured in
[`src/lib/config.js`](src/lib/config.js):

```js
export const DIAGNOSTICS = {
  console: true, // mirror every event to console.debug
  max: 200,      // ring-buffer cap for the in-app panel
};
```

Console rows land at `console.debug`, so enable **Verbose** in DevTools to see
them. Set `console: false` to keep the panel while silencing the console.

## Quick start

Requires **Node 18+** and a Deepgram API key ([console.deepgram.com](https://console.deepgram.com)).

```sh
npm install
cp .env.example .env      # then edit .env and set DEEPGRAM_API_KEY
npm run dev
```

`npm run dev` runs two processes via `concurrently`:

- **server** (`:3000`) — the Node token endpoint (`/api/token`); holds the API key.
- **client** (`:5173`) — Vite dev server; proxies `/api/token` to the server.

Open **http://localhost:5173**, click **Start listening**, allow the mic, and
speak. Pause, and it repeats your turn. Talk over it — or click **Stop
speaking** — to trigger barge-in.

> Use `http://localhost` (or https). Microphone capture is blocked on insecure
> origins.

## Production

```sh
npm run build     # emits ./dist
npm start         # build + serve ./dist and /api/token from one origin (:3000)
```

In production there's no proxy: the Node server serves the built app **and**
mints tokens from the same origin.

## Architecture

Identical data flow to the vanilla example (see its
[README](../basic-html-js/README.md#architecture) for the full diagram): the
browser talks **directly** to Deepgram over WebSockets using a short-lived
token; the Node server exists only to keep the API key secret.

## Make it a real assistant

Pass a `respond` function to `useConversation({ respond })`, or replace
`echoResponder` in [`src/lib/conversation.js`](src/lib/conversation.js) with a
call to your LLM. It can return a `Promise<string>`, or you can stream tokens
into `tts.speak()` as they arrive. The capture / turn-taking / barge-in /
playback machinery is unchanged.
