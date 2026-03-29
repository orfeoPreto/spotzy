import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SearchBar from '../../../components/SearchBar';

const mockOnDestinationSelect = vi.fn();
const mockOnFilterOpen = vi.fn();
const mockOnDatesChange = vi.fn();

const defaultProps = {
  onDestinationSelect: mockOnDestinationSelect,
  onFilterOpen: mockOnFilterOpen,
  onDatesChange: mockOnDatesChange,
  activeFilterCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('SearchBar rendering', () => {
  it('renders destination input field', () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByPlaceholderText(/destination|where|location/i)).toBeInTheDocument();
  });

  it('renders date/time inputs', () => {
    render(<SearchBar {...defaultProps} />);
    const dateInputs = document.querySelectorAll('input[type="datetime-local"], input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders filter button with funnel icon', () => {
    render(<SearchBar {...defaultProps} />);
    const filterBtn = screen.getByRole('button', { name: /filter/i });
    expect(filterBtn).toBeInTheDocument();
  });
});

describe('SearchBar autocomplete', () => {
  it('calls Mapbox Geocoding API when user types 3+ characters', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { place_name: 'Brussels, Belgium', center: [4.352, 50.85] },
        ],
      }),
    });

    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText(/destination|where|location/i);
    await user.type(input, 'Bru');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('shows suggestions dropdown with returned results', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { place_name: 'Brussels, Belgium', center: [4.352, 50.85] },
        ],
      }),
    });

    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText(/destination|where|location/i);
    await user.type(input, 'Bru');

    await waitFor(() => {
      expect(screen.getByText('Brussels, Belgium')).toBeInTheDocument();
    });
  });

  it('calls onDestinationSelect when a suggestion is selected', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { place_name: 'Brussels, Belgium', center: [4.352, 50.85] },
        ],
      }),
    });

    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText(/destination|where|location/i);
    await user.type(input, 'Bru');

    await waitFor(() => screen.getByText('Brussels, Belgium'));
    await user.click(screen.getByText('Brussels, Belgium'));

    expect(mockOnDestinationSelect).toHaveBeenCalledWith({
      label: 'Brussels, Belgium',
      lat: 50.85,
      lng: 4.352,
    });
  });

  it('does not call API when fewer than 3 characters are typed', async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText(/destination|where|location/i);
    await user.type(input, 'Br');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('SearchBar filter button', () => {
  it('calls onFilterOpen when filter button is clicked', async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /filter/i }));
    expect(mockOnFilterOpen).toHaveBeenCalledTimes(1);
  });

  it('shows active filter count badge when activeFilterCount > 0', () => {
    render(<SearchBar {...defaultProps} activeFilterCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show badge when activeFilterCount is 0', () => {
    render(<SearchBar {...defaultProps} activeFilterCount={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('SearchBar date inputs', () => {
  it('calls onDatesChange when dates change', () => {
    render(<SearchBar {...defaultProps} />);
    const inputs = document.querySelectorAll('input[type="datetime-local"], input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: '2025-06-01T10:00' } });
    expect(mockOnDatesChange).toHaveBeenCalled();
  });

  it('end date cannot be before start date (validation)', async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const inputs = document.querySelectorAll('input[type="datetime-local"], input[type="date"]');
    const startInput = inputs[0] as HTMLInputElement;
    const endInput = inputs[1] as HTMLInputElement;

    fireEvent.change(startInput, { target: { value: '2025-06-10T10:00' } });
    fireEvent.change(endInput, { target: { value: '2025-06-05T10:00' } });

    await waitFor(() => {
      const errorMsg = screen.queryByText(/end.*before.*start|invalid.*date|end date/i);
      expect(errorMsg).toBeInTheDocument();
    });
  });
});
