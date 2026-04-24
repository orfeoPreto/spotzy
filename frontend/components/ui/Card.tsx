'use client';

import { HTMLAttributes, forwardRef } from 'react';

export type CardAccent = 'forest' | 'emerald' | 'brick' | 'concrete' | 'mint' | 'red' | 'none';

const accentBorderColors: Record<CardAccent, string> = {
  forest: 'border-l-[#004526]',
  emerald: 'border-l-[#006B3C]',
  brick: 'border-l-[#AD3614]',
  concrete: 'border-l-[#B0BEC5]',
  mint: 'border-l-[#B8E6D0]',
  red: 'border-l-[#DC2626]',
  none: '',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: CardAccent;
  bg?: 'white' | 'mist';
  hoverable?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ accent = 'none', bg = 'white', hoverable = true, className = '', children, ...props }, ref) => {
    const bgClass = bg === 'mist' ? 'bg-[#EFF5F1]' : 'bg-white';
    const accentClass = accent !== 'none' ? `border-l-4 ${accentBorderColors[accent]}` : '';

    return (
      <div
        ref={ref}
        className={`
          rounded-xl shadow-sm-spotzy
          ${bgClass}
          ${accentClass}
          ${hoverable ? 'grow group hover:shadow-md-spotzy' : ''}
          ${className}
        `.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
export default Card;
