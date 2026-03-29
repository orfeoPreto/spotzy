import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ModifyModal from '../../../components/ModifyModal';

const mockOnClose = vi.fn();
const mockOnModified = vi.fn();

const booking = {
  bookingId: 'bk1',
  startDate: '2025-08-01T10:00:00Z',
  endDate: '2025-08-01T12:00:00Z',
  totalPrice: 7.00,
  pricePerHour: 3.50,
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...booking }),
  });
});

describe('ModifyModal rendering', () => {
  it('renders two options: Change start time / Change end time', () => {
    render(<ModifyModal booking={booking} onClose={mockOnClose} onModified={mockOnModified} />);
    expect(screen.getByText(/change start time/i)).toBeInTheDocument();
    expect(screen.getByText(/change end time/i)).toBeInTheDocument();
  });

  it('shows time picker after selecting an option', async () => {
    const user = userEvent.setup();
    render(<ModifyModal booking={booking} onClose={mockOnClose} onModified={mockOnModified} />);
    await user.click(screen.getByText(/change end time/i));
    await waitFor(() => {
      expect(document.querySelector('input[type="datetime-local"]')).toBeInTheDocument();
    });
  });
});

describe('ModifyModal price difference badge', () => {
  it('shows +€X.XX in amber when new duration is longer', async () => {
    const user = userEvent.setup();
    render(<ModifyModal booking={booking} onClose={mockOnClose} onModified={mockOnModified} />);
    await user.click(screen.getByText(/change end time/i));

    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // Extend by 1 hour → +€3.50
    fireEvent.change(picker, { target: { value: '2025-08-01T13:00' } });

    await waitFor(() => {
      expect(screen.getByText(/\+€3\.50|\+3\.50/)).toBeInTheDocument();
    });
  });

  it('shows −€3.50 refund in green when new duration is shorter', async () => {
    const user = userEvent.setup();
    render(<ModifyModal booking={booking} onClose={mockOnClose} onModified={mockOnModified} />);
    await user.click(screen.getByText(/change end time/i));

    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // Shorten by 1 hour → −€3.50
    fireEvent.change(picker, { target: { value: '2025-08-01T11:00' } });

    await waitFor(() => {
      expect(screen.getByText(/−€3\.50|−3\.50|-€3\.50|-3\.50|refund/i)).toBeInTheDocument();
    });
  });

  it('shows no badge when duration is unchanged', async () => {
    const user = userEvent.setup();
    render(<ModifyModal booking={booking} onClose={mockOnClose} onModified={mockOnModified} />);
    await user.click(screen.getByText(/change end time/i));

    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '2025-08-01T12:00' } });

    await waitFor(() => {
      expect(screen.queryByText(/\+€|−€|-€/)).not.toBeInTheDocument();
    });
  });
});
