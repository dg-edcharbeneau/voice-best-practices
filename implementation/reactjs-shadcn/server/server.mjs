// -----------------------------------------------------------------------------
// Token server + streaming chat proxy (+ static server for the built app)
//
// This server does three jobs, and keeps EVERY provider secret on the server:
//   1. GET  /api/token  -> mint a short-lived Deepgram token for the browser
//   2. POST /api/chat   -> proxy a chat turn to the LLM and STREAM the reply back
//   3. serve the Vite build in ../dist (production)
//
// Best practice #1 (from ../../BEST_PRACTICES.md): neither the Deepgram API key
// NOR the LLM key ever reaches the browser. The browser opens Deepgram STT/TTS
// WebSockets directly using the short-lived token, and it talks to the LLM only
// through /api/chat here — so audio and prompts stay on the paths you control.
//
// In DEV, Vite serves the React app on :5173 and proxies BOTH /api/token and
// /api/chat here (see vite.config.js). In PROD, `npm run build` then this server
// serves ../dist and both endpoints from one origin.
// -----------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DeepgramClient } from "@deepgram/sdk";
import OpenAI from "openai";

// Load .env. `dotenvFile` is the PARSED file contents; we read the LLM settings
// from it directly (below) rather than from process.env. Why: a global
// `export OPENAI_API_KEY=…` / `OPENAI_BASE_URL=…` in your shell (e.g. a stale
// AWS Bedrock gateway token) lives in process.env and would otherwise shadow the
// key you put in .env — surfacing later as a confusing provider auth error like
// "Signature expired". Reading OPENAI_* straight from the file makes .env win for
// the LLM, while Deepgram/PORT still fall back to the shell if absent from .env.
const { parsed: dotenvFile = {} } = dotenv.config();

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

const PORT = Number(process.env.PORT || 3000);
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 60);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
// LLM settings come from the .env FILE only (see the dotenv note above), so a
// stray global OPENAI_* export can't shadow them.
const OPENAI_API_KEY = dotenvFile.OPENAI_API_KEY;
const OPENAI_MODEL = dotenvFile.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL = dotenvFile.OPENAI_BASE_URL || "https://api.openai.com/v1";

// Belt-and-suspenders: the LLM settings are now captured from the .env FILE, so
// scrub any shell-exported OPENAI_* out of process.env. We already pass apiKey +
// baseURL to the OpenAI client explicitly, but this guarantees nothing downstream
// — the SDK's own env fallback, or a future refactor that reads process.env —
// can ever pick up a stray shell value (e.g. a Bedrock gateway token) instead of
// your .env key. DEEPGRAM_API_KEY is intentionally left alone (it may legitimately
// come from the shell).
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_BASE_URL;

// The assistant's persona. Because replies are spoken aloud, steer the model
// toward short, speech-friendly answers (no markdown, lists, code, or emoji).
const SYSTEM_PROMPT =
  "You are a concise, friendly voice assistant. Your replies are spoken aloud, " +
  "so keep them to one to three short sentences and avoid markdown, bullet " +
  "lists, code blocks, and emoji.";

// Fail fast with actionable messages — this demo needs BOTH keys.
const missing = [];
if (!DEEPGRAM_API_KEY)
  missing.push("DEEPGRAM_API_KEY (https://console.deepgram.com)");
if (!OPENAI_API_KEY) {
  missing.push(
    "OPENAI_API_KEY — must be set in the .env FILE (https://platform.openai.com)"
  );
}
if (missing.length) {
  console.error(
    `\n  Missing required environment variable(s):\n` +
      missing.map((m) => `    - ${m}`).join("\n") +
      `\n\n  Copy .env.example to .env and fill them in.\n`
  );
  process.exit(1);
}

// --- Deepgram: mint short-lived browser tokens -------------------------------
const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });

// --- LLM: server-side client. Pass apiKey AND baseURL explicitly so the SDK
// can't fall back to reading the shell's OPENAI_* (the exports we're bypassing).
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

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
// Streams the assistant's reply back as plain UTF-8 text chunks (the client
// appends them to the in-progress bubble and, for spoken turns, speaks the full
// reply once the stream ends). If the client disconnects (barge-in aborts the
// fetch), we abort the upstream LLM call too so we stop paying for tokens no one
// will hear (Best practice #4 — barge-in stops generation, not just audio).
function handleChat(req, res) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    // Basic guard against unbounded bodies.
    if (raw.length > 1_000_000) req.destroy();
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

    // Abort the upstream LLM stream if — and only if — the CLIENT disconnects
    // before we've finished responding (a barge-in aborts the browser fetch), so
    // we stop paying for tokens no one will hear (Best practice #4).
    //
    // We listen on the RESPONSE's "close", not the request's: `req` emits "close"
    // as soon as the request body is fully received, which would abort the call
    // instantly (the stream then yields nothing and the client hangs in
    // "thinking"). `res` "close" fires when the response finishes OR the socket
    // drops early — so we gate on `!res.writableEnded` to catch only the latter.
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });

    try {
      const stream = await openai.chat.completions.create(
        {
          model: OPENAI_MODEL,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            // Only forward the fields the API expects.
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        { signal: ac.signal }
      );

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        // Discourage proxies from buffering the stream.
        "X-Accel-Buffering": "no",
      });

      for await (const part of stream) {
        const delta = part.choices?.[0]?.delta?.content;
        if (delta) res.write(delta);
      }
      res.end();
    } catch (err) {
      if (ac.signal.aborted) {
        // Client went away (barge-in / navigation) — nothing to report.
        try {
          res.end();
        } catch {}
        return;
      }
      console.error("Chat completion failed:", err);
      if (!res.headersSent) {
        send(res, 502, JSON.stringify({ error: "chat_failed" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } else {
        try {
          res.end();
        } catch {}
      }
    }
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
        `  Something else (another server, Docker, etc.) is listening there.\n` +
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
  console.log(`\n  Voice + shadcn/ui best-practices server on :${PORT}`);
  console.log(`  Dev UI:  http://localhost:5173  (Vite; proxies /api/* here)`);
  console.log(`  Prod UI: http://localhost:${PORT}  (after \`npm run build\`)\n`);
  console.log(
    `  Deepgram token TTL: ${TOKEN_TTL_SECONDS}s  |  LLM: ${OPENAI_MODEL} @ ${OPENAI_BASE_URL}`
  );
  console.log(
    `  Keys: server-side only  |  LLM read from .env file (shell OPENAI_* ignored)\n`
  );
});
