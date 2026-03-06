import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onError: (message: string) => void;
  fallbackTitle?: string;
  fallbackDescription?: string;
};

type State = {
  hasError: boolean;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message || "Unexpected render error");
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-fallback">
          <h2>{this.props.fallbackTitle ?? "Something went wrong."}</h2>
          <p>{this.props.fallbackDescription ?? "Reload the app to recover from this error."}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

