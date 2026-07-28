# Voice UI Best Practices

Reference implementations of a **realtime voice UI** — microphone → Deepgram
streaming STT (Flux) → turn detection → Deepgram TTS (Speak), with start/stop
and barge-in — built the same way across different stacks.

The behaviors are the point, and they're the same everywhere. The companion
guide, [**BEST_PRACTICES.md**](BEST_PRACTICES.md), explains the *why* behind each
one; every example below implements them.

## The problem

Wiring a microphone to a speech API and playing audio back is easy. Building a
voice interface that actually feels *good* is not — and the hard parts are the
same regardless of framework:

- **Turn-taking is genuinely hard.** Knowing when a user has finished a thought
  (versus just pausing) is a real signal-processing problem. Most demos fake it
  with a fixed silence timer that either cuts people off or feels sluggish.
- **Barge-in is usually missing.** A voice UI that can't be interrupted
  mid-sentence feels broken, yet stopping playback *and* halting buffered audio
  already in flight is fiddly to get right.
- **The audio pipeline is full of traps.** Deprecated capture APIs that glitch
  under load, sample-rate mismatches, gappy playback, echo from TTS bleeding
  back into the mic and triggering false turns, empty frames that silently close
  the stream.
- **Security gets skipped.** The quickest path — shipping the API key to the
  browser — leaks it to the world.
- **State goes implicit.** Voice UIs are turn-taking state machines, but they're
  often built from scattered booleans that contradict each other, leaving the
  user unsure whether the app is even listening.

The result is that everyone rebuilds the same voice UI from scratch, rediscovers
the same pitfalls, and ships something subtly wrong. There's no canonical answer
to *"what does a correct realtime voice interface actually do, and what does the
code look like?"*

This project is that answer: a set of framework-independent behaviors a voice UI
should get right ([**BEST_PRACTICES.md**](BEST_PRACTICES.md)), each paired with
working reference implementations across common stacks. Copy the one that matches
your stack, or read the guide once and apply it anywhere.

## Examples

| Example | Stack | Status |
|---|---|---|
| [`examples/basic-html-js`](examples/basic-html-js) | Vanilla HTML/CSS/JS + a tiny Node token server. No bundler. | ✅ Ready |
| [`examples/reactjs`](examples/reactjs) | React 19 + Vite (same behaviors, componentized). | ✅ Ready |
| [`examples/reactjs-copilotkit`](examples/reactjs-copilotkit) | React 19 + Vite wired to CopilotKit's `CopilotChat` and a real LLM — voice in, voice out, plus a typeable chat. | ✅ Ready |
| [`implementation/reactjs-shadcn`](implementation/reactjs-shadcn) | React 19 + Vite with a modern chat UI built from shadcn/ui + Tailwind, a real LLM via a streaming `/api/chat` endpoint — voice in, voice out, plus a typeable chat. | ✅ Ready |
| [`examples/blazor`](examples/blazor) | Blazor WebAssembly (.NET 10) + ASP.NET Core token host, using JS isolation for interop. | ✅ Ready |

Each example is self-contained, with its own README and setup steps. Start with
the one that matches your stack.

## The shared guide

[**BEST_PRACTICES.md**](BEST_PRACTICES.md) is framework-independent — read it
once and the concepts apply to every example: keeping the API key server-side,
the single-source-of-truth state machine, turn-taking, barge-in, gap-free
playback, teardown, and accessibility.

## Adding an example

New stacks are welcome. Keep them consistent so the collection reads as one set:

1. Create `examples/<stack-name>/` self-contained (its own manifest — `package.json`,
   `.csproj`, etc. — and a README).
2. Implement the same behaviors and states described in
   [BEST_PRACTICES.md](BEST_PRACTICES.md) — don't restate the guide, link to it.
3. Keep the Deepgram API key server-side (mint short-lived browser tokens).
4. Add a row to the table above.

## License

MIT
