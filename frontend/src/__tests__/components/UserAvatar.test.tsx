import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UserAvatar } from '../../../components/UserAvatar';

describe('UserAvatar', () => {
  it('renders img when photoUrl provided', () => {
    render(<UserAvatar user={{ photoUrl: 'https://img.test/photo.jpg', pseudo: 'Spot', firstName: 'Alice' }} size={40} />);
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://img.test/photo.jpg');
    expect(img).toHaveAttribute('alt', 'Spot');
  });

  it('renders initial fallback with bg-[#004526] when no photo', () => {
    render(<UserAvatar user={{ photoUrl: null, pseudo: 'Spot', firstName: 'Alice' }} size={40} />);
    const fallback = screen.getByTestId('avatar-fallback');
    expect(fallback).toBeInTheDocument();
    expect(fallback.className).toContain('bg-[#004526]');
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('fallback uses firstName initial when pseudo is null', () => {
    render(<UserAvatar user={{ photoUrl: null, pseudo: null, firstName: 'Bob' }} size={40} />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('size prop controls width/height', () => {
    render(<UserAvatar user={{ photoUrl: null, pseudo: null, firstName: 'Carl' }} size={64} />);
    const container = screen.getByTestId('avatar-container');
    expect(container.style.width).toBe('64px');
    expect(container.style.height).toBe('64px');
  });
});
