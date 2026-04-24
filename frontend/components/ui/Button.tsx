'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';

export type ButtonVariant =
  | 'primary-forest'
  | 'primary-emerald'
  | 'primary-park'
  | 'brick'
  | 'secondary'
  | 'outline-forest'
  | 'outline-brick'
  | 'disabled';

const variantClasses: Record<ButtonVariant, string> = {
  'primary-forest':
    'bg-[#004526] text-white hover:bg-[#003318] shadow-forest focus-visible:ring-[#004526]',
  'primary-emerald':
    'bg-[#006B3C] text-white hover:bg-[#005A30] focus-visible:ring-[#006B3C]',
  'primary-park':
    'bg-[#059669] text-white hover:bg-[#047857] focus-visible:ring-[#059669]',
  brick:
    'bg-[#AD3614] text-white hover:bg-[#8F2C10] shadow-brick focus-visible:ring-[#AD3614]',
  secondary:
    'bg-[#EBF7F1] text-[#004526] hover:bg-[#D4EDDF] focus-visible:ring-[#006B3C]',
  'outline-forest':
    'border border-[#004526] text-[#004526] bg-transparent hover:bg-[#EBF7F1] focus-visible:ring-[#004526]',
  'outline-brick':
    'border border-[#AD3614] text-[#AD3614] bg-transparent hover:bg-[#F5E6E1] focus-visible:ring-[#AD3614]',
  disabled:
    'bg-[#B0BEC5] text-white cursor-not-allowed opacity-60',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-[13px]',
  md: 'px-4 py-2 text-[14px]',
  lg: 'px-6 py-3 text-[15px]',
  'full-width': 'w-full px-6 py-3 text-[15px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof sizeClasses;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary-emerald', size = 'md', className = '', disabled, children, ...props }, ref) => {
    const effectiveVariant = disabled ? 'disabled' : variant;

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`
          inline-flex items-center justify-center gap-2
          rounded-lg font-semibold font-head
          transition-colors touch-target
          ${!disabled ? 'grow-btn' : ''}
          ${variantClasses[effectiveVariant]}
          ${sizeClasses[size]}
          ${className}
        `.trim()}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
