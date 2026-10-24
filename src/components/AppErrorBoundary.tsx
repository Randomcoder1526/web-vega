import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportUnexpectedIssue } from "../lib/errors/errorReporter";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportUnexpectedIssue("react", error, {
      details: {
        componentStack: info.componentStack || undefined,
      },
    });
  }

  private reload = () => window.location.reload();

  private goHome = () => {
    window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#09090b",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <section style={{ width: "min(520px, 100%)", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "10px" }}>
            Vega hit an unexpected error
          </h1>
          <p style={{ opacity: 0.78, lineHeight: 1.5, marginBottom: "20px" }}>
            The error was recorded. Reload Vega, or return home and try another source.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px" }}>
            <button type="button" onClick={this.reload} style={{ padding: "10px 16px", borderRadius: "10px", cursor: "pointer" }}>
              Reload
            </button>
            <button type="button" onClick={this.goHome} style={{ padding: "10px 16px", borderRadius: "10px", cursor: "pointer" }}>
              Go Home
            </button>
          </div>
        </section>
      </main>
    );
  }
}
