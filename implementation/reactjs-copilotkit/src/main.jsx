import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CopilotKit } from "@copilotkit/react-core";
// CopilotKit's default component styles. Imported before index.css so our own
// theme overrides (see index.css → ".copilot-chat") win.
import "@copilotkit/react-ui/styles.css";
import App from "./App.jsx";
import "./index.css";

// <CopilotKit> points the app at the runtime we host in server/server.mjs. The
// browser never sees the LLM key — requests go to /api/copilotkit (proxied to
// the Node server in dev; same origin in prod).
// showDevConsole={false}: CopilotKit's dev console is shown automatically in
// development, but its colors are light-only (we don't remap them), so it reads
// as a stray light banner in dark mode. Off for a clean demo.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <CopilotKit runtimeUrl="/api/copilotkit" showDevConsole={false}>
      <App />
    </CopilotKit>
  </StrictMode>
);
