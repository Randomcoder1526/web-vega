import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import { tauriAxiosAdapter } from "./lib/providers/tauriAxiosAdapter";
import "./styles/index.css";
import App from "./App";
import "./styles/responsive.css";
import { init as initNavigation } from "@noriginmedia/norigin-spatial-navigation";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { classifyPlaybackError } from "./lib/playback/playbackErrors";
import { installGlobalErrorHandlers } from "./lib/errors/errorReporter";
import { toast } from "./lib/zustand/toastStore";

// Force all axios requests across the application to route through the Tauri Rust backend
// bypassing browser CORS and enabling DoH / TLS emulation.
axios.defaults.adapter = tauriAxiosAdapter;

// Spatial navigation must be initialized before React mounts.
// Use the unified Norigin package so the navigation service and React hooks
// share the same runtime instance. Initialize before React mounts so every
// focusable ref can be measured by the browser implementation.
initNavigation({
  debug: false,
  visualDebug: false,
  distanceCalculationMethod: "corners",
});


installGlobalErrorHandlers({
  classifyKnownError: classifyPlaybackError,
  notifyUnexpected: (issue) => {
    toast({
      title: "Unexpected Vega error",
      message: issue.message || "Something unexpected happened.",
      type: "error",
      duration: 6500,
    });
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
