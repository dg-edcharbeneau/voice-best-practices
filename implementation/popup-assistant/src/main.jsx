import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles/popup.css"; // the widget's own self-contained styles
import "./demo.css"; // demo-page-only styling (not part of the widget)

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
