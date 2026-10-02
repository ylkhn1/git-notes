import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";

import "@/app/styles.css";

// The webview's native context menu (with "Inspect Element") is useful in development only.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
