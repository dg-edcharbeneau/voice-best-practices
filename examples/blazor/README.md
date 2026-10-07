# Blazor — Voice UI Best Practices

The same realtime voice UI as [`../basic-html-js`](../basic-html-js) and
[`../reactjs`](../reactjs) — start/stop, voice-activity feedback, turn-taking, and
barge-in — built with **Blazor WebAssembly (.NET 10)**. For the *why* behind every
behavior, read the shared guide: [**BEST_PRACTICES.md**](../../BEST_PRACTICES.md).

> Direct STT/TTS — **not** the Voice Agent platform. There's no LLM; the demo
> echoes you. The one-line spot where an LLM would go is the `respond` seam in
> [`wwwroot/js/conversation.js`](VoiceBestPractices.Client/wwwroot/js/conversation.js).

## How it maps to Blazor

This repo's thesis is that the realtime machinery is **framework-agnostic**:
capture, sockets, playback, and the turn-taking state machine are plain ES modules,
shared in spirit with the vanilla and React examples. Blazor — exactly like React —
owns only the *edges*: turning the orchestrator's callbacks into UI state, and
rendering.

| Concern | Where it lives |
|---|---|
| State machine (idle → connecting → listening → thinking → speaking) | [`wwwroot/js/conversation.js`](VoiceBestPractices.Client/wwwroot/js/conversation.js) |
| Mic / STT / TTS / player / token / config | [`wwwroot/js/`](VoiceBestPractices.Client/wwwroot/js/) (ported from vanilla) |
| Audio-thread capture worklet | [`wwwroot/js/pcm-worklet.js`](VoiceBestPractices.Client/wwwroot/js/pcm-worklet.js) |
| **JS-isolation bridge** — orchestrator callbacks ⇄ .NET | [`wwwroot/js/voice-interop.js`](VoiceBestPractices.Client/wwwroot/js/voice-interop.js) |
| Turn-taking / barge-in trace (event shape + console mirror) | [`wwwroot/js/diagnostics.js`](VoiceBestPractices.Client/wwwroot/js/diagnostics.js) |
| **Session service** — holds state, owns the interop, the analog of React's `useConversation` | [`Voice/ConversationService.cs`](VoiceBestPractices.Client/Voice/ConversationService.cs) |
| **Interop wrapper** — typed JS-isolation module, `DotNetObjectReference`, teardown | [`Voice/ConversationInterop.cs`](VoiceBestPractices.Client/Voice/ConversationInterop.cs) |
| State enum + labels + friendly errors (the "edge" logic, in C#) | [`Voice/ConversationState.cs`](VoiceBestPractices.Client/Voice/ConversationState.cs) |
| Thin page — renders service state, forwards clicks, stops on unmount | [`Pages/Home.razor.cs`](VoiceBestPractices.Client/Pages/Home.razor.cs) |
| UI, split into components | [`Components/`](VoiceBestPractices.Client/Components/) |
| Token endpoint (holds the API key) | [`Program.cs`](VoiceBestPractices/Program.cs) |

### JS interop uses JS isolation — two flavors

Both are ES modules loaded on demand; **nothing is attached to `window`**, and there
are no `<script>` tags.

1. **Imported wrapper** for the main feature.
   [`ConversationInterop`](VoiceBestPractices.Client/Voice/ConversationInterop.cs)
   imports `./js/voice-interop.js` with
   `IJSRuntime.InvokeAsync<IJSObjectReference>("import", …)`, hands it a
   `DotNetObjectReference` so Flux turn events / transcript / level / errors call back
   into C#, and disposes the module (catching `JSDisconnectedException`).
2. **Collocated module** for a local DOM job.
   [`Transcript.razor.js`](VoiceBestPractices.Client/Components/Transcript.razor.js)
   lives next to its component and only keeps the transcript scrolled to the newest turn.

Method names and module paths are `const`s (a typo can't silently break a callback),
all interop runs in `OnAfterRenderAsync`/event handlers (never during prerender), and
`StateHasChanged` is always marshalled through `InvokeAsync`.

### Components

- [`Home.razor`](VoiceBestPractices.Client/Pages/Home.razor) — the interactive page.
  Sets `data-state` on the root (drives all state-based CSS) and lays out the panels.
  It's a thin view: its [`.razor.cs`](VoiceBestPractices.Client/Pages/Home.razor.cs)
  injects `ConversationService`, re-renders on its `Changed` event, and stops the
  session on unmount — no session state or orchestration lives in the page.
- [`StatusPanel`](VoiceBestPractices.Client/Components/StatusPanel.razor) composes the
  status row, mic meter, and controls.
- [`StatusIndicator`](VoiceBestPractices.Client/Components/StatusIndicator.razor) ·
  [`MicMeter`](VoiceBestPractices.Client/Components/MicMeter.razor) ·
  [`Controls`](VoiceBestPractices.Client/Components/Controls.razor) ·
  [`Transcript`](VoiceBestPractices.Client/Components/Transcript.razor) ·
  [`Diagnostics`](VoiceBestPractices.Client/Components/Diagnostics.razor) ·
  [`ErrorBanner`](VoiceBestPractices.Client/Components/ErrorBanner.razor)

Data flows **down** via `[Parameter]`; events flow **up** via `EventCallback`. Button
enable/disable is derived purely from the machine state, so the controls can't drift
out of sync with what's actually possible.

### Diagnostics

Turn-taking and barge-in are the hardest behaviors here and the least visible —
the status label says "speaking", then it doesn't, and everything interesting
happened in between. The **Diagnostics** panel (open by default, under the
transcript) makes the loop legible:

| Channel | What it shows |
|---|---|
| `turn` | every Flux `TurnInfo` event except `Update`, plus why a turn has or hasn't settled |
| `barge-in` | each cut-off: what it interrupted, `playedMs`, the abandoned turn index, whether an in-flight response was aborted, and Deepgram's `SpeechInterrupted` reply (`text_spoken` / `text_remaining`) |
| `tts` | each `Speak` + `Flush` pair and its ack, so streaming granularity is visible |
| `state` | every state-machine transition |

`EndOfTurn` and `turn settled` are the two halves of turn-taking: the first ends
the *user's* turn, the second ends the *agent's*. When the UI looks stuck on
"speaking", the `not settled` rows name the exact latch holding it there
(responder still generating, flushes outstanding, or player draining).

The orchestrator emits these through one more callback (`onDiagnostic`) next to
`onState` / `onTranscript` / `onError`, so `wwwroot/js/` stays framework-agnostic.
The path to the screen is the same one every other callback takes:

1. [`voice-interop.js`](VoiceBestPractices.Client/wwwroot/js/voice-interop.js)
   mirrors each event to the console and relays it to `[JSInvokable] OnDiagnostic`.
2. [`ConversationService`](VoiceBestPractices.Client/Voice/ConversationService.cs)
   appends it to a bounded buffer (`MaxDiagnostics = 200`; the oldest rows fall off)
   and raises `Changed`.
3. [`Diagnostics.razor`](VoiceBestPractices.Client/Components/Diagnostics.razor)
   renders the rows newest-first — pure CSS, no JS interop.

The console mirror is gated in
[`wwwroot/js/config.js`](VoiceBestPractices.Client/wwwroot/js/config.js):

```js
export const DIAGNOSTICS = {
  console: true, // mirror every event to console.debug
};
```

Console rows land at `console.debug`, so enable **Verbose** in DevTools to see
them. Set `console: false` to keep the panel while silencing the console.

## Quick start

Requires the **.NET 10 SDK** and a Deepgram API key ([console.deepgram.com](https://console.deepgram.com)).

```sh
cd VoiceBestPractices

# The key lives ONLY on the server. Use an env var…
export DEEPGRAM_API_KEY=your_key
# …or user-secrets (kept out of the repo):
#   dotnet user-secrets set DEEPGRAM_API_KEY your_key

dotnet run
```

Open the URL printed by `dotnet run` (e.g. **https://localhost:7xxx**), click
**Start listening**, allow the mic, and speak. Pause, and it repeats your turn. Talk
over it — or click **Stop speaking** — to trigger barge-in.

> Use `https://localhost` (or `http://localhost`). Microphone capture is blocked on
> insecure origins.

## Architecture

Identical data flow to the other examples (see the vanilla
[README](../basic-html-js/README.md#architecture) for the full diagram): the browser
talks **directly** to Deepgram over WebSockets using a short-lived token. Unlike the
React example there is no separate dev proxy — the ASP.NET Core host serves the
WebAssembly app **and** mints tokens from the same origin, so `fetch("api/token")`
just works.

### Why WebAssembly (not Interactive Server)?

Every signal here is browser-native and high-frequency: mic frames every ~80 ms, level
updates many times a second, audio scheduled sample-accurately. Interactive Server
would push all of that over a SignalR circuit. WebAssembly runs the whole loop in the
browser where the audio actually is, and JS interop is a same-process call.

## Make it a real assistant

The "brain" is the `respond` seam in
[`wwwroot/js/respond.js`](VoiceBestPractices.Client/wwwroot/js/respond.js). Two
responders ship, and echo is the default:

- **`echoResponder`** — says your finished turn back (no LLM needed).
- **`llmResponder`** — POSTs the finished turn to the server's `/api/chat`, which
  streams the reply back token-by-token; the client speaks complete sentences as
  they arrive.

**Why the LLM call is on the server, not in C#:** this is Blazor *WebAssembly*, so
your C# runs in the browser. Putting the model call in a `.Client` service would
leak the model key exactly like a client-side Deepgram key would. So the LLM lives
in the **server project** ([`Program.cs`](VoiceBestPractices/Program.cs), the
`POST /api/chat` endpoint) behind `Microsoft.Extensions.AI`'s `IChatClient` — the
key stays server-side, same rule as the Deepgram token. `IChatClient` is
provider-agnostic (OpenAI, Azure OpenAI, or any OpenAI-compatible endpoint via
`OpenAI:Endpoint`).

**Turn it on:**

```sh
# In addition to DEEPGRAM_API_KEY, configure a model (server-side only):
dotnet user-secrets set OpenAI:ApiKey sk-...        # or export OpenAI__ApiKey=sk-...
# optional: dotnet user-secrets set OpenAI:Model gpt-4o-mini
```

Then flip the one-line switch in
[`wwwroot/js/voice-interop.js`](VoiceBestPractices.Client/wwwroot/js/voice-interop.js):

```js
const respond = llmResponder;   // was: echoResponder
```

Without `OpenAI:ApiKey`, `/api/chat` returns **501** and the echo demo runs
untouched.

**Barge-in cancels the LLM too.** The `respond` contract passes an `AbortSignal`;
`interrupt()` / `interruptResponse()` abort it, which aborts the `fetch` — and
because the server's streaming loop honors the request-aborted `CancellationToken`,
generation stops server-side as well. No tokens are spent finishing a turn the user
already talked over. (`EagerEndOfTurn` in
[`conversation.js`](VoiceBestPractices.Client/wwwroot/js/conversation.js) is the spot
to *pre-warm* the request for even lower latency.)
