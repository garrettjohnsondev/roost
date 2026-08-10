import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

/** Without this, any render-time exception silently unmounts the whole app to a blank
 *  white page with zero diagnostic trail — the exact failure mode that made a real bug
 *  unreportable. This catches it and shows the actual error instead. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? null });
    console.error('Pocket crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <h1>Something broke</h1>
          <p>Pocket hit an error and couldn't continue. The details below are safe to screenshot and share.</p>
          <pre className="crash-detail">
            {this.state.error.message}
            {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
            {this.state.info ? '\n\n--- component stack ---' + this.state.info : ''}
          </pre>
          <button className="primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
