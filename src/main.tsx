import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CloseGuard from "./components/CloseGuard";
import { applyTheme } from "./theme";
import "./fonts.css";

// Set the saved theme before the first paint to avoid a flash.
applyTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <CloseGuard />
  </React.StrictMode>,
);
