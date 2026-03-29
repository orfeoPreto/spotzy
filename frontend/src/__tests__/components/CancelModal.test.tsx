import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CancelModal from '../../../components/CancelModal';

const mockOnClose = vi.fn();
const mockOnCancelled = vi.fn();

const baseBooking = {
  bookingId: 'bk1',
  startDate: '2025-08-01T10:00:00Z', // far in future → full refund
  endDate: '2025-08-01T12:00:00Z',
  totalPrice: 7.00,
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ refundAmount: 7.00 }),
  });
});

describe('CancelModal rendering', () => {
  it('shows refund amount prominently in green', () => {
    render(
      <CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    const refundEl = screen.getByText(/€7\.00/);
    expect(refundEl).toBeInTheDocument();
    // Check it has a green-ish class
    const container = refundEl.closest('[class*="green"]') ?? refundEl;
    expect(container).toBeInTheDocument();
  });

  it('shows "€0.00 refund" messaging when no refund applies', () => {
    render(
      <CancelModal booking={baseBooking} refundAmount={0} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    expect(screen.getByText('No refund applies')).toBeInTheDocument();
  });

  it('shows countdown timer when within 48h of start time', () => {
    const soon = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(); // 10h from now
    render(
      <CancelModal
        booking={{ ...baseBooking, startDate: soon }}
        refundAmount={0}
        onClose={mockOnClose}
        onCancelled={mockOnCancelled}
      />,
    );
    expect(screen.getByText(/hours? remaining|time remaining|countdown/i)).toBeInTheDocument();
  });

  it('renders "Yes, cancel" and "Keep my booking" buttons', () => {
    render(
      <CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    expect(screen.getByRole('button', { name: /yes, cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep my booking/i })).toBeInTheDocument();
  });
});

describe('CancelModal interactions', () => {
  it('"Keep my booking" closes modal without API call', async () => {
    const user = userEvent.setup();
    render(
      <CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    await user.click(screen.getByRole('button', { name: /keep my booking/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('"Yes, cancel" makes API call and shows success', async () => {
    const user = userEvent.setup();
    render(
      <CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    await user.click(screen.getByRole('button', { name: /yes, cancel/i }));
    await waitFor(() => {
      expect(mockOnCancelled).toHaveBeenCalledTimes(1);
    });
    expect(global.fetch).toHaveBeenCalled();
  });

  it('shows spinner and disables buttons during API call', async () => {
    let resolveCancel!: (v: unknown) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((res) => { resolveCancel = res; }),
    );
    const user = userEvent.setup();
    render(
      <CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />,
    );
    await user.click(screen.getByRole('button', { name: /yes, cancel/i }));
    expect(screen.getByRole('button', { name: /yes, cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /keep my booking/i })).toBeDisabled();
    resolveCancel({ ok: true, json: async () => ({ refundAmount: 7 }) });
  });
});

describe('CancelModal refund display accuracy', () => {
  it('shows €7.00 refund when refundAmount=7.00', () => {
    render(<CancelModal booking={baseBooking} refundAmount={7.00} onClose={mockOnClose} onCancelled={mockOnCancelled} />);
    expect(screen.getByText(/€7\.00/)).toBeInTheDocument();
  });

  it('shows €3.50 refund when refundAmount=3.50', () => {
    render(<CancelModal booking={baseBooking} refundAmount={3.50} onClose={mockOnClose} onCancelled={mockOnCancelled} />);
    expect(screen.getByText(/€3\.50/)).toBeInTheDocument();
  });

  it('shows "No refund applies" when refundAmount=0', () => {
    render(<CancelModal booking={baseBooking} refundAmount={0} onClose={mockOnClose} onCancelled={mockOnCancelled} />);
    expect(screen.getByText(/no refund applies/i)).toBeInTheDocument();
  });
});
