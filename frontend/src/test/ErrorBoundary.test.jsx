import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary';

function Broken() {
  throw new Error('chunk failed to load');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary fallback={<p>Fallback</p>}>
        <p>Content</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();
  });

  it('shows the fallback instead of crashing when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <ErrorBoundary fallback={<p>Fallback</p>}>
          <Broken />
        </ErrorBoundary>
        <p>Rest of the page</p>
      </>,
    );

    expect(screen.getByText('Fallback')).toBeInTheDocument();
    expect(screen.getByText('Rest of the page')).toBeInTheDocument();
  });
});
