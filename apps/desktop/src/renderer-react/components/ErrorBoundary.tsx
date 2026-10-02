import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[React ErrorBoundary caught error]:", error, errorInfo);
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{ padding: "24px", color: "var(--color-label-primary)" }}>
          <h3 style={{ margin: "0 0 8px 0" }}>Component Render Error</h3>
          <pre style={{ color: "#fc0035", fontSize: "12px", background: "rgba(252, 0, 53, 0.08)", padding: "12px", borderRadius: "6px", overflowX: "auto" }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: "12px", padding: "6px 14px", cursor: "pointer", borderRadius: "6px" }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
