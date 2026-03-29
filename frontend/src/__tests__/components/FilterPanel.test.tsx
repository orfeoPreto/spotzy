import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FilterPanel from '../../../components/FilterPanel';

const mockOnApply = vi.fn();
const mockOnClear = vi.fn();

const defaultProps = {
  resultCount: 12,
  onApply: mockOnApply,
  onClear: mockOnClear,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilterPanel rendering', () => {
  it('renders all filter sections', () => {
    render(<FilterPanel {...defaultProps} />);
    expect(screen.getByText(/availability/i)).toBeInTheDocument();
    expect(screen.getByText(/price/i)).toBeInTheDocument();
    expect(screen.getByText(/spot type/i)).toBeInTheDocument();
    expect(screen.getByText(/features/i)).toBeInTheDocument();
  });

  it('renders 4 spot type chips', () => {
    render(<FilterPanel {...defaultProps} />);
    const spotTypeSection = screen.getByText(/spot type/i).closest('section') ??
      screen.getByText(/spot type/i).parentElement;
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    expect(chips.length).toBe(4);
  });

  it('shows result count in apply button', () => {
    render(<FilterPanel {...defaultProps} resultCount={12} />);
    expect(screen.getByRole('button', { name: /show 12 spots/i })).toBeInTheDocument();
  });
});

describe('FilterPanel interactions', () => {
  it('selecting a spot type chip gives it selected state', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    await user.click(chips[0] as HTMLElement);
    expect(chips[0]).toHaveClass('border-amber');
  });

  it('selecting same chip again deselects it (toggle)', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    const chip = chips[0] as HTMLElement;
    await user.click(chip);
    await user.click(chip);
    expect(chip).not.toHaveClass('border-amber');
  });

  it('can select multiple spot type chips simultaneously', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    await user.click(chips[0] as HTMLElement);
    await user.click(chips[1] as HTMLElement);
    expect(chips[0]).toHaveClass('border-amber');
    expect(chips[1]).toHaveClass('border-amber');
  });

  it('clicking Clear all resets filters and calls onClear', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    await user.click(chips[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(chips[0]).not.toHaveClass('border-amber');
    expect(mockOnClear).toHaveBeenCalledTimes(1);
  });

  it('clicking Apply calls onApply with current filter state', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const chips = document.querySelectorAll('[data-testid="spot-type-chip"]');
    await user.click(chips[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /show \d+ spots/i }));
    expect(mockOnApply).toHaveBeenCalledTimes(1);
    expect(mockOnApply).toHaveBeenCalledWith(
      expect.objectContaining({ spotTypes: expect.arrayContaining([expect.any(String)]) }),
    );
  });

  it('selecting Privately owned feature toggle makes it active', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...defaultProps} />);
    const toggle = screen.getByLabelText(/privately owned/i);
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe('FilterPanel price range', () => {
  it('renders price range inputs', () => {
    render(<FilterPanel {...defaultProps} />);
    const priceInputs = document.querySelectorAll('input[type="range"], input[type="number"]');
    expect(priceInputs.length).toBeGreaterThanOrEqual(1);
  });
});
