// -----------------------------------------------------------------------------
// Token server + CopilotKit runtime (+ static server for the built app)
//
// This server does three jobs, and keeps EVERY provider secret on the server:
//   1. GET  /api/token       -> mint a short-lived Deepgram token for the browser
//   2. POST /api/copilotkit  -> the CopilotKit runtime; talks to the LLM provider
//   3. serve the Vite build in ../dist (production)
//
// Best practice #1 (from ../../BEST_PRACTICES.md): neither the Deepgram API key
// NOR the LLM key ever reaches the browser. The browser opens Deepgram STT/TTS
// WebSockets directly using the short-lived token, and it talks to the LLM only
// through the CopilotKit runtime hosted here — so audio and prompts stay on the
// paths you control.
//
// In DEV, Vite serves the React app on :5173 and proxies BOTH /api/token and
// /api/copilotkit here (see vite.config.js). In PROD, `npm run build` then this
// server serves ../dist and both endpoints from one origin.
// -----------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DeepgramClient } from "@deepgram/sdk";

// Load .env. `dotenvFile` is the PARSED file contents; we read the LLM settings
// from it directly (below) rather than from process.env. Why: a global
// `export OPENAI_API_KEY=…` / `OPENAI_BASE_URL=…` in your shell (e.g. a stale
// AWS Bedrock gateway token) lives in process.env and would otherwise shadow the
// key you put in .env — surfacing later as a confusing provider auth error like
// "Signature expired". Reading OPENAI_* straight from the file makes .env win for
// the LLM, while Deepgram/PORT still fall back to the shell if absent from .env.
const { parsed: dotenvFile = {} } = dotenv.config();
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

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
const COPILOTKIT_ENDPOINT = "/api/copilotkit";

// Fail fast with actionable messages — this demo needs BOTH keys.
const missing = [];
if (!DEEPGRAM_API_KEY) missing.push("DEEPGRAM_API_KEY (https://console.deepgram.com)");
if (!OPENAI_API_KEY) {
  missing.push("OPENAI_API_KEY — must be set in the .env FILE (https://platform.openai.com)");
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
// The SDK reads DEEPGRAM_API_KEY from the environment by default; we pass it
// explicitly to keep the dependency obvious.
const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });

// --- CopilotKit runtime ------------------------------------------------------
// The runtime is CopilotKit's secure server-side proxy: the browser's <CopilotKit>
// provider POSTs here, and the runtime relays to the LLM using a service adapter.
// Swapping providers is a one-liner — replace OpenAIAdapter with AnthropicAdapter,
// GroqAdapter, GoogleGenerativeAIAdapter, etc. (all exported from
// @copilotkit/runtime). See the README for the Anthropic variant.
// Pass apiKey AND baseURL explicitly. If we left either off, the OpenAI SDK
// would fall back to reading process.env.OPENAI_API_KEY / OPENAI_BASE_URL — i.e.
// the very shell exports we're trying to bypass. The fail-fast check above
// guarantees OPENAI_API_KEY is set before we get here.
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });
const serviceAdapter = new OpenAIAdapter({ openai, model: OPENAI_MODEL });
const runtime = new CopilotRuntime();

// A ready-to-mount Node http handler bound to our endpoint path.
const copilotHandler = copilotRuntimeNodeHttpEndpoint({
  endpoint: COPILOTKIT_ENDPOINT,
  runtime,
  serviceAdapter,
});

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

// --- static files (production build) -----------------------------------------
async function handleStatic(req, res) {
  // Resolve within DIST_DIR and reject path traversal.
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
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
    // No build yet? Point the developer at the right command.
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

  // The CopilotKit runtime handles its own methods (POST, plus GET for info).
  if (path === COPILOTKIT_ENDPOINT || path.startsWith(`${COPILOTKIT_ENDPOINT}/`)) {
    return copilotHandler(req, res);
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
  console.log(`\n  Voice + CopilotKit best-practices server on :${PORT}`);
  console.log(`  Dev UI:  http://localhost:5173  (Vite; proxies /api/* here)`);
  console.log(`  Prod UI: http://localhost:${PORT}  (after \`npm run build\`)\n`);
  console.log(`  Deepgram token TTL: ${TOKEN_TTL_SECONDS}s  |  LLM: ${OPENAI_MODEL} @ ${OPENAI_BASE_URL}`);
  console.log(`  Keys: server-side only  |  LLM read from .env file (shell OPENAI_* ignored)\n`);
});
