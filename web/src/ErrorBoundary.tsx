import { reportCrash } from './reportCrash';
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
    console.error('Roost crashed:', error, info.componentStack);
    reportCrash('crash screen', error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <h1>Something broke</h1>
          <p>Roost hit an error and couldn't continue. The details below are safe to screenshot and share.</p>
          <pre className="crash-detail">
            {this.state.error.message}
            {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
            {this.state.info ? '\n\n--- component stack ---' + this.state.info : ''}
          </pre>
          <div className="crash-actions">
            <button className="primary" onClick={() => location.reload()}>
              Reload
            </button>
            {/* Reload re-opens the same broken view; home usually does not. */}
            <button onClick={() => location.assign('/')}>Back to home</button>
            {/* Served by the server as plain HTML — it works when this app does not. */}
            <a className="crash-rescue" href="/rescue">Open rescue</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Renders a function's output inside the boundary, so an exception thrown while
 *  COMPUTING the view (not just in a child) is caught here too. */
function Run({ fn }: { fn: () => ReactNode }) {
  return <>{fn()}</>;
}

interface ContainedProps {
  /** What failed, in the fallback's words: "This message", "The conversation". */
  what: string;
  children: ReactNode | (() => ReactNode);
  /** When this changes, try again: a half-streamed message that failed may
   *  render once it is complete. */
  retryOn?: unknown;
}

/** One bad message costs one message, not the app. 2026-09-24: a single
 *  render bug took down every session for a day, because the only boundary was
 *  around the whole app. Each transcript row sits inside one of these now; the
 *  header, the composer and every other message keep working, and the crash is
 *  still reported to the server log. */
export class Contained extends Component<ContainedProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: ContainedProps) {
    if (this.state.error && prev.retryOn !== this.props.retryOn) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.what} couldn't be shown:`, error, info.componentStack);
    reportCrash(`contained: ${this.props.what}`, error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="contained-error" role="note">
          <span>{this.props.what} couldn't be shown.</span>
          <details>
            <summary>Details</summary>
            <code>{this.state.error.message}</code>
          </details>
        </div>
      );
    }
    const c = this.props.children;
    return typeof c === 'function' ? <Run fn={c} /> : c;
  }
}
