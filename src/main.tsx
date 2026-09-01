import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CloseGuard from "./components/CloseGuard";
import { applyTheme } from "./theme";
import { applyAccent } from "./accent";
import { applyTextScale } from "./textScale";
import "./fonts.css";

// Set the saved theme, accent and text size before the first paint to avoid a
// flash.
applyTheme();
applyAccent();
applyTextScale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <CloseGuard />
  </React.StrictMode>,
);
