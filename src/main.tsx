import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components";
import "./styles.css";
import "./reading.css";
import "./ui.css";
import "./reader-ui.css";
import "./ebook-ui.css";
import "./preset-ui.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
