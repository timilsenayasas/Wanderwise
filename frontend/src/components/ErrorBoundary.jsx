import { Component } from 'react';

/**
 * Shows `fallback` instead of crashing the page when something inside throws while rendering,
 * for example a lazy-loaded chunk that fails to download.
 *   <ErrorBoundary fallback={<p>The map couldn't load.</p>}>…</ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
