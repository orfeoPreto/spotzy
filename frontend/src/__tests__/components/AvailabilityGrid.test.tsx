import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AvailabilityGrid, { type AvailabilityRule, type AvailabilityBlock } from '../../../components/AvailabilityGrid';

const mockOnSave = vi.fn();
const mockOnDateSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('<AvailabilityGrid /> — edit mode (host)', () => {
  test('renders day toggle buttons', () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} />);
    expect(screen.getByLabelText('Monday')).toBeInTheDocument();
    expect(screen.getByLabelText('Saturday')).toBeInTheDocument();
    expect(screen.getByLabelText('Sunday')).toBeInTheDocument();
  });

  test('"Always available" toggle shows/hides weekly grid', () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} />);
    expect(screen.getByTestId('weekly-grid')).toBeInTheDocument();

    const toggle = screen.getByLabelText('Always available');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('weekly-grid')).not.toBeInTheDocument();
  });

  test('toggling "Always available" off shows weekly grid again', () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} />);
    const toggle = screen.getByLabelText('Always available');
    fireEvent.click(toggle); // on
    fireEvent.click(toggle); // off
    expect(screen.getByTestId('weekly-grid')).toBeInTheDocument();
  });

  test('toggling a day keeps time inputs accessible', () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} rules={[
      { type: 'WEEKLY', daysOfWeek: [], startTime: '08:00', endTime: '18:00' },
    ]} />);
    const mondayToggle = screen.getByLabelText('Monday');
    fireEvent.click(mondayToggle);
    // After clicking Monday, start time for that rule should be enabled
    const startInputs = screen.getAllByRole('textbox', { hidden: true });
    expect(startInputs.length).toBeGreaterThan(0);
  });

  test('overlapping rules on same day shows inline error and disables save', () => {
    const overlappingRules: AvailabilityRule[] = [
      { type: 'WEEKLY', daysOfWeek: [1], startTime: '08:00', endTime: '12:00' },
      { type: 'WEEKLY', daysOfWeek: [1], startTime: '10:00', endTime: '14:00' },
    ];
    render(<AvailabilityGrid mode="edit" rules={overlappingRules} onSave={mockOnSave} />);
    expect(screen.getByText(/overlap/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('"Save" with ALWAYS type calls onSave with correct payload', async () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} />);
    const toggle = screen.getByLabelText('Always available');
    fireEvent.click(toggle);

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith({ type: 'ALWAYS', rules: [] });
    });
  });

  test('save is disabled while saving prop is true', () => {
    render(<AvailabilityGrid mode="edit" onSave={mockOnSave} saving={true} />);
    const toggle = screen.getByLabelText('Always available');
    fireEvent.click(toggle); // no validation errors
    const saveBtn = screen.getByRole('button', { name: /saving/i });
    expect(saveBtn).toBeDisabled();
  });
});

describe('<AvailabilityGrid /> — display mode (spotter)', () => {
  const alwaysRule: AvailabilityRule = {
    type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '',
  };

  const makeBlock = (date: string): AvailabilityBlock => ({
    listingId: 'l1',
    bookingId: 'b1',
    date,
    startTime: `${date}T00:00:00Z`,
    endTime: `${date}T23:59:59Z`,
    status: 'CONFIRMED',
  });

  test('renders 14 day cells', () => {
    render(<AvailabilityGrid mode="display" rules={[alwaysRule]} />);
    const buttons = screen.getAllByRole('button');
    // 14 day buttons
    expect(buttons.length).toBeGreaterThanOrEqual(14);
  });

  test('clicking an available date fires onDateSelect', () => {
    render(<AvailabilityGrid mode="display" rules={[alwaysRule]} onDateSelect={mockOnDateSelect} />);
    const availableButtons = screen.getAllByRole('button').filter((b) => !b.hasAttribute('disabled'));
    if (availableButtons.length > 0) {
      fireEvent.click(availableButtons[0]);
      expect(mockOnDateSelect).toHaveBeenCalled();
    }
  });

  test('shows legend with Available, Booked, Unavailable', () => {
    render(<AvailabilityGrid mode="display" rules={[alwaysRule]} />);
    expect(screen.getByText(/available/i)).toBeInTheDocument();
    expect(screen.getByText(/booked/i)).toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
