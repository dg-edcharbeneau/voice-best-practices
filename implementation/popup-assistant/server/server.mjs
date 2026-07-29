// -----------------------------------------------------------------------------
// Deepgram token server + stub chat responder (+ static server for the build)
//
// This prototype uses ONLY Deepgram — there is no LLM. The server does three
// jobs, and keeps the Deepgram secret on the server:
//   1. GET  /api/token  -> mint a short-lived Deepgram token for the browser
//   2. POST /api/chat   -> STREAM back a canned reply (no LLM key required)
//   3. serve the Vite build in ../dist (production)
//
// Best practice #1 (from ../../BEST_PRACTICES.md): the Deepgram API key never
// reaches the browser. The browser opens Deepgram STT/TTS WebSockets directly
// using the short-lived token minted here.
//
// Why a stub /api/chat? The point of this prototype is the popup UX and the
// full voice loop (mic → STT → turn-taking → TTS → barge-in), not answer
// quality. The stub streams a short reply word-by-word so the client's
// sentence-by-sentence TTS path is exercised exactly as it would be with a real
// streaming LLM — just swap this handler for an LLM proxy to make it "real"
// (Best practice #11 — the brain is pluggable).
//
// In DEV, Vite serves the React app on :5173 and proxies /api/* here (see
// vite.config.js). In PROD, `npm run build` then this server serves ../dist and
// the endpoints from one origin.
// -----------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import dotenv from "dotenv";
import { DeepgramClient } from "@deepgram/sdk";

dotenv.config();

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

const PORT = Number(process.env.PORT || 3000);
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 60);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// Fail fast with an actionable message — this prototype needs the Deepgram key.
if (!DEEPGRAM_API_KEY) {
  console.error(
    `\n  Missing required environment variable:\n` +
      `    - DEEPGRAM_API_KEY (https://console.deepgram.com)\n\n` +
      `  Copy .env.example to .env and fill it in.\n`
  );
  process.exit(1);
}

// --- Deepgram: mint short-lived browser tokens -------------------------------
const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });

// --- The canned "brain" ------------------------------------------------------
// A tiny scripted responder. It does a shallow keyword match on the user's last
// turn and otherwise rotates through a few friendly, speech-friendly lines
// (short, no markdown — they get read aloud). Replace with an LLM proxy for a
// real assistant.
const SCRIPTED = [
  "Hey there! This is a Deepgram voice popup prototype. Try asking me something, or type below.",
  "Got it. In a real build this is where a language model would answer — here I'm just a friendly stub.",
  "Nice. Everything you're hearing is Deepgram text to speech, streamed back sentence by sentence.",
  "You can talk over me any time to interrupt — that's barge-in, and it stops me instantly.",
  "Prefer typing? Switch to the text view. Prefer another language? Pick one up top and I'll switch voices.",
];

function pickReply(messages) {
  const lastUser = [...(messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const text = (lastUser?.content || "").toLowerCase();

  if (/\b(hi|hello|hey|hola|bonjour|hallo)\b/.test(text)) {
    return "Hello! Great to hear you. Ask me anything, or just say hi in your language.";
  }
  if (/\b(bye|goodbye|adios|adiós|au revoir|tschüss|tschuss)\b/.test(text)) {
    return "Talk soon! You can close the popup whenever you like.";
  }
  if (text.includes("thank")) {
    return "You're very welcome!";
  }
  if (text.includes("?")) {
    return "That's a good question. In this prototype I don't have a real brain yet, but the whole voice loop around me is fully wired.";
  }
  // Rotate through the scripted lines by a stable index derived from how many
  // user turns have happened, so repeated turns don't always get line one.
  const userTurns = (messages || []).filter((m) => m.role === "user").length;
  return SCRIPTED[userTurns % SCRIPTED.length];
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

// --- GET /api/token ----------------------------------------------------------
// Returns { access_token, expires_in }. The browser uses access_token as the
// "bearer" WebSocket subprotocol when connecting to Deepgram.
async function handleToken(res) {
  try {
    const result = await deepgram.auth.v1.tokens.grant({
      ttl_seconds: TOKEN_TTL_SECONDS,
    });
    send(res, 200, JSON.stringify(result), {
      "Content-Type": "application/json; charset=utf-8",
      // Tokens are per-session secrets: never let a proxy or the browser cache them.
      "Cache-Control": "no-store",
    });
  } catch (err) {
    console.error("Failed to grant token:", err);
    send(res, 502, JSON.stringify({ error: "token_grant_failed" }), {
      "Content-Type": "application/json; charset=utf-8",
    });
  }
}

// --- POST /api/chat ----------------------------------------------------------
// Body: { messages: [{ role, content }, …] } — the conversation so far.
// Streams a canned reply back as plain-text chunks, word by word with a tiny
// delay, so the client's sentence-streaming TTS starts speaking on the first
// finished sentence — exactly the shape a streaming LLM would produce. If the
// client disconnects (barge-in aborts the fetch), we stop writing immediately
// (Best practice #4 — barge-in stops "generation", not just audio).
function handleChat(req, res) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy(); // guard against unbounded bodies
  });
  req.on("end", async () => {
    let messages;
    try {
      ({ messages } = JSON.parse(raw || "{}"));
    } catch {
      return send(res, 400, JSON.stringify({ error: "invalid_json" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    }
    if (!Array.isArray(messages)) {
      return send(res, 400, JSON.stringify({ error: "messages_required" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    }

    // Stop "generating" as soon as the client goes away (barge-in / navigation).
    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });

    const reply = pickReply(messages);
    const words = reply.split(" ");

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // discourage proxies from buffering the stream
    });

    for (let i = 0; i < words.length; i++) {
      if (aborted) break;
      res.write(i === 0 ? words[i] : ` ${words[i]}`);
      // ~55 ms/word ≈ a brisk speaking cadence; enough to exercise streaming.
      await sleep(55);
    }
    try {
      res.end();
    } catch {}
  });
}

// --- static files (production build) -----------------------------------------
async function handleStatic(req, res) {
  const urlPath = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname
  );
  const relPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(join(DIST_DIR, relPath));

  if (!filePath.startsWith(DIST_DIR)) {
    return send(res, 403, "Forbidden");
  }

  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  } catch {
    send(
      res,
      404,
      "Not found. In dev, open http://localhost:5173 (Vite). For a production " +
        "server, run `npm run build` first so ../dist exists."
    );
  }
}

const server = createServer((req, res) => {
  const path = req.url.split("?")[0];

  if (req.method === "POST" && path === "/api/chat") {
    return handleChat(req, res);
  }
  if (req.method === "GET" && path === "/api/token") {
    return handleToken(res);
  }
  if (req.method === "GET") {
    return handleStatic(req, res);
  }
  send(res, 405, "Method not allowed");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use.\n` +
        `  Free it, or start on a different port:\n\n` +
        `      PORT=3100 npm run dev\n\n` +
        `  (or set PORT in your .env file)\n`
    );
  } else {
    console.error("\n  Server failed to start:", err.message, "\n");
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  Popup voice assistant server on :${PORT}`);
  console.log(`  Dev UI:  http://localhost:5173  (Vite; proxies /api/* here)`);
  console.log(`  Prod UI: http://localhost:${PORT}  (after \`npm run build\`)\n`);
  console.log(
    `  Deepgram token TTL: ${TOKEN_TTL_SECONDS}s  |  Brain: canned stub (no LLM key)\n`
  );
});
