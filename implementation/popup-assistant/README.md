# Popup Voice Assistant (Deepgram)

A **popup-style voice assistant** prototype, in the spirit of the floating "chat
bubble" widgets you see in the corner of product sites — but voice-first, and
powered entirely by **Deepgram**.

It starts **minimized** as a labeled *Voice Chat* launcher pinned to a screen
corner. Click it and it expands into a **voice-first** panel: a live status orb
you tap to start talking, a **language selector**, and a **text composer** as an
accessibility fallback for people who’d rather type. Minimize it mid-conversation
and it collapses to a small floating pill that keeps the session alive and shows
the live status (“Listening…”).

Built on the shared voice engine from this repo’s other examples, so it follows
the same [BEST_PRACTICES.md](../../BEST_PRACTICES.md).

> **Prototype scope.** The chat "brain" is a **canned stub** on the server — no
> LLM, no OpenAI key. The point is the popup UX and the full Deepgram voice loop
> (mic → STT → turn-taking → TTS → barge-in), not answer quality. The responder
> lives behind a single seam (`respond()`), so swapping in a real streaming LLM
> is a one-file change (Best practice #11).

## Quick start

```bash
cp .env.example .env      # then paste your DEEPGRAM_API_KEY
npm install
npm run dev               # server on :3000, Vite UI on :5173
```

Open **http://localhost:5173**, click the **Voice Chat** launcher in the corner,
tap the orb, and start speaking. (Mic capture needs a secure context — `localhost`
counts.)

## Using the widget

The entire widget is one component:

```jsx
import { VoiceAssistant } from "./components/VoiceAssistant.jsx";

<VoiceAssistant anchor="bottom-left" defaultLanguage="en" />
```

| Prop              | Type                                                                 | Default         | Description                                             |
| ----------------- | -------------------------------------------------------------------- | --------------- | ------------------------------------------------------- |
| `anchor`          | `"bottom-left" \| "bottom-right" \| "top-left" \| "top-right"`       | `"bottom-left"` | Which screen corner the popup pins to.                  |
| `defaultLanguage` | `"en" \| "es" \| "fr" \| "de"`                                       | `"en"`          | Language the session starts in (user can change it).    |

Its styles are **self-contained** and fully scoped under `.va-root` — no Tailwind,
no CSS framework, nothing that leaks into the host page. Drop it into any React app.

## Language selection & the STT fork

Language is chosen **manually** on purpose. Even when a spoken language could be
auto-detected, multilingual users often prefer a different one (e.g. an
Eastern-European speaker who’d rather use English). Changing the language
restarts the session on the right models.

Deepgram’s speech-to-text has an honest split here, and the code handles both
behind one event vocabulary (see [`src/lib/stt.js`](src/lib/stt.js)):

| Language          | STT                                        | TTS voice (Aura-2)   |
| ----------------- | ------------------------------------------ | -------------------- |
| English (`en`)    | **Flux** `/v2/listen` — built-in turn-taking | `aura-2-thalia-en`   |
| Spanish (`es`)    | **Nova-3** `/v1/listen` + turn adapter     | `aura-2-celeste-es`  |
| French (`fr`)     | **Nova-3** `/v1/listen` + turn adapter     | `aura-2-agathe-fr`   |
| German (`de`)     | **Nova-3** `/v1/listen` + turn adapter     | `aura-2-julius-de`   |

Flux gives English turn detection (`StartOfTurn`/`EndOfTurn`) for free. For the
other languages, a small adapter turns Nova-3’s interim results + VAD/utterance
events into the *same* turn events, so the orchestrator never learns which
backend is live. Voice IDs and language codes come from Deepgram’s docs; the
authoritative list for your account is `GET https://api.deepgram.com/v1/models`.

## How it’s wired

```
VoiceAssistant                 corner anchoring, open/minimized surfaces
 ├─ LauncherPill               collapsed "Voice Chat" button
 ├─ MinimizedStatus            floating "Listening…" pill (session stays live)
 └─ AssistantPanel             expanded UI
     ├─ LanguageSelect         manual language picker
     ├─ VoiceOrb               tap-to-start / barge-in + live level display
     ├─ StatusLine             the one visible state (aria-live)
     ├─ ChatView               text transcript (voice + typed turns)
     └─ Composer               text fallback input

useConversation  → lib/conversation.js  (state machine, turn-taking, barge-in)
useChat          → /api/chat            (canned streaming reply → spoken via TTS)
lib/{stt,tts,mic,player,token,config,preflight}.js   the shared voice engine
server/server.mjs   mint Deepgram tokens + stub /api/chat + serve the build
```

The UI is a pure projection of the orchestrator’s `state` via a single
`data-state` attribute (Best practice #2): the accent color, status dot, orb
ring, and speaking glow all follow it.

## Best practices in play

Key server-side + short-lived tokens (#1); one visible state (#2);
model-driven turn-taking, Flux directly and Nova-3 normalized (#3); barge-in
that cuts audio, clears buffered TTS, and aborts the reply stream (#4);
mic-level feedback in the orb (#5); AudioContext resumed inside the tap gesture
(#7); full teardown on End/Close but **not** on minimize (#8); `aria-live`
status, real focusable buttons, `prefers-reduced-motion`, and OS dark mode (#9);
preflight + friendly permission/error messages surfaced in the panel (#10);
pluggable `respond()` brain (#11).

See [BEST_PRACTICES.md](../../BEST_PRACTICES.md) for the full guide.
