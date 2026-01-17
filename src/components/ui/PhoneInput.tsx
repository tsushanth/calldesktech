'use client';

import React, { useState, useCallback } from 'react';
import { cn, isValidUSPhone } from '@/lib/utils';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
  placeholder?: string;
  className?: string;
}

export function PhoneInput({
  value,
  onChange,
  error,
  label = 'Phone Number',
  placeholder = '(555) 123-4567',
  className,
}: PhoneInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  // Format phone number as user types
  const formatPhoneNumber = useCallback((input: string): string => {
    // Remove all non-digits
    const digits = input.replace(/\D/g, '');

    // Limit to 10 digits
    const limited = digits.slice(0, 10);

    // Format as (XXX) XXX-XXXX
    if (limited.length === 0) return '';
    if (limited.length <= 3) return `(${limited}`;
    if (limited.length <= 6) return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
    return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    onChange(formatted);
  };

  const isValid = value.length === 0 || isValidUSPhone(value);

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <span className="text-gray-400">+1</span>
        </div>
        <input
          type="tel"
          value={value}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className={cn(
            'w-full pl-12 pr-4 py-4 text-lg font-medium',
            'border rounded-lg transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            'placeholder-gray-400 text-gray-900 bg-white',
            error || (!isValid && !isFocused && value.length > 0)
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300'
          )}
        />
        {value.length === 14 && isValid && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
            <svg
              className="h-5 w-5 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-500">{error}</p>
      )}
      {!isValid && !isFocused && value.length > 0 && !error && (
        <p className="mt-1 text-sm text-red-500">Please enter a valid US phone number</p>
      )}
    </div>
  );
}
