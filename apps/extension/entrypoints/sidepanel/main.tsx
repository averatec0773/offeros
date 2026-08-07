import React from "react";
import ReactDOM from "react-dom/client";
import "../../src/assets/main.css";
import App from "./App";
import { startDevReload } from "../../src/lib/dev-reload";

// Dev builds only (inert without a build stamp): refresh the open panel when
// a fresh build lands, before the background's slightly-delayed full reload.
void startDevReload(() => location.reload());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
