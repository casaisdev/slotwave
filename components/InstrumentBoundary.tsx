"use client";

import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/**
 * A runtime error in the canvas or the audio layer must not take the page
 * down. A crashed instrument may leave orphaned audio timers behind, so the
 * only safe recovery is a full reload, offered instead of a white screen.
 */
export default class InstrumentBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("instrument crashed", error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex w-full flex-col items-center gap-4 border border-muted/30 px-6 py-16">
        <p className="font-mono text-sm lowercase text-muted">
          the instrument hit an error and stopped
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border border-muted/40 px-6 py-2 font-mono text-sm lowercase text-signal transition-colors hover:border-signal"
        >
          reload the page
        </button>
      </div>
    );
  }
}
