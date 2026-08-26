import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockRoundStore: Record<string, unknown> = {
  activeRound: null,
  isRoundActive: false,
  sseConnection: { status: 'connected' },
};

vi.mock('../store/useRoundStore', () => ({
  useRoundStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockRoundStore);
    }
    return mockRoundStore;
  }),
}));

import RoundTimeline from './RoundTimeline';

function setRoundState(state: Partial<typeof mockRoundStore>) {
  Object.assign(mockRoundStore, state);
}

function getCurrentStateLabel() {
  const container = screen.getByText('Current State:').parentElement;
  return container?.querySelector('span:last-child');
}

describe('RoundTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setRoundState({
      activeRound: null,
      isRoundActive: false,
      sseConnection: { status: 'connected' },
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders successfully and shows timeline header', () => {
    render(<RoundTimeline />);

    expect(screen.getByRole('heading', { name: /Round Progress/i })).toBeInTheDocument();
    expect(screen.getByText(/Current State:/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Upcoming/i).length).toBeGreaterThan(0);
  });

  it('renders upcoming state when there is no active round', () => {
    setRoundState({ activeRound: null, isRoundActive: false, sseConnection: { status: 'connected' } });
    render(<RoundTimeline />);

    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0);
    const currentStateContainer = screen.getByText('Current State:').closest('div');
    expect(currentStateContainer).toBeTruthy();
    expect(currentStateContainer && currentStateContainer.textContent).toMatch(/Upcoming/i);
  });

  it('renders live state when the active round is live', () => {
    setRoundState({
      activeRound: { id: 'r1', status: 'live', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() },
      isRoundActive: true,
      sseConnection: { status: 'connected' },
    });

    render(<RoundTimeline />);

    expect(getCurrentStateLabel()?.textContent).toMatch(/Live/i);
    expect(screen.getByText(/Starts:/i)).toBeInTheDocument();
    expect(screen.getByText(/Ends:/i)).toBeInTheDocument();
  });

  it('renders resolving state for a round with resolving status', () => {
    setRoundState({
      activeRound: { id: 'r2', status: 'resolving', startsAt: new Date().toISOString() },
      isRoundActive: false,
      sseConnection: { status: 'connected' },
    });

    render(<RoundTimeline />);

    expect(getCurrentStateLabel()?.textContent).toMatch(/Resolving/i);
  });

  it('renders finished state when round status is resolved', () => {
    setRoundState({
      activeRound: { id: 'r3', status: 'resolved', resolvedAt: new Date().toISOString() },
      isRoundActive: false,
      sseConnection: { status: 'connected' },
    });

    render(<RoundTimeline />);

    expect(getCurrentStateLabel()?.textContent).toMatch(/Finished/i);
  });

  it('updates current stage indicator when round data changes', () => {
    const { rerender } = render(<RoundTimeline />);

    expect(getCurrentStateLabel()?.textContent).toMatch(/Upcoming/i);

    setRoundState({
      activeRound: { id: 'r4', status: 'live', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 120000).toISOString() },
      isRoundActive: true,
    });

    rerender(<RoundTimeline />);
    expect(getCurrentStateLabel()?.textContent).toMatch(/Live/i);
  });

  it('shows loading state when SSE is connecting or reconnecting', () => {
    setRoundState({
      activeRound: null,
      isRoundActive: false,
      sseConnection: { status: 'connecting' },
    });

    render(<RoundTimeline />);

    expect(screen.getByText(/Connecting to live updates.../i)).toBeInTheDocument();
  });

  it('shows disconnected warning when SSE status is disconnected', () => {
    setRoundState({
      activeRound: null,
      isRoundActive: false,
      sseConnection: { status: 'disconnected' },
    });

    render(<RoundTimeline />);

    expect(screen.getByText(/Connection lost - Timeline may not update in real-time/i)).toBeInTheDocument();
    expect(getCurrentStateLabel()?.textContent).toMatch(/Unknown/i);
  });

  it('handles empty round data gracefully', () => {
    setRoundState({ activeRound: null, isRoundActive: false, sseConnection: { status: 'connected' } });

    const renderComponent = () => render(<RoundTimeline />);
    expect(renderComponent).not.toThrow();
    renderComponent();
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0);
  });
});