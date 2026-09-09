import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CloseGuard from "./components/CloseGuard";
import { applyTheme, onThemeChange } from "./theme";
import { applyAccent } from "./accent";
import { applyTextScale } from "./textScale";
import { applyVibrancy } from "./vibrancy";
import "./fonts.css";

// Set the saved theme, accent and text size before the first paint to avoid a
// flash. The theme goes first: the accent's readable-text variant is measured
// against the theme's backdrop, so it needs the theme already on the document.
applyTheme();
applyAccent();
applyTextScale();
// Only marks the document on macOS, where the window really is a vibrancy
// surface; everywhere else every surface stays opaque.
applyVibrancy();

// Keep that variant honest when the theme is switched at runtime.
onThemeChange(applyAccent);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <CloseGuard />
  </React.StrictMode>,
);
