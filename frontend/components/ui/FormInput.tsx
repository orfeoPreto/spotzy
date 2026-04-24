'use client';

import { forwardRef, InputHTMLAttributes } from 'react';

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, helperText, className = '', id, disabled, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-medium text-[#004526]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={`
            w-full rounded-lg border bg-[#EBF7F1] px-3 py-2.5
            text-[15px] text-[#1C2B1A] font-sans
            placeholder:text-[#4B6354]/60
            transition-all duration-150
            ${error
              ? 'border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/20 focus:border-[#DC2626]'
              : 'border-[#C8DDD2] hover:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20 focus:border-[#006B3C]'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed bg-[#EFF5F1]' : ''}
            outline-none
            ${className}
          `.trim()}
          {...props}
        />
        {error && (
          <p className="text-[12px] text-[#DC2626]">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-[12px] text-[#4B6354]">{helperText}</p>
        )}
      </div>
    );
  }
);

FormInput.displayName = 'FormInput';
export default FormInput;
