import type { InputHTMLAttributes, ReactNode } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  labelAccessory?: ReactNode
  error?: string
  required?: boolean
}

export function Input({ label, labelAccessory, error, required, className = '', id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-medium text-[var(--color-text-primary)]">
            {label}
            {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
          </label>
          {labelAccessory}
        </div>
      )}
      <input
        id={inputId}
        className={`
          h-10 px-3 rounded-[var(--radius-md)] border text-sm
          bg-[var(--color-surface)] text-[var(--color-text-primary)]
          placeholder:text-[var(--color-text-tertiary)]
          transition-colors duration-150
          ${error
            ? 'border-[var(--color-error)] focus:shadow-[var(--shadow-error-ring)]'
            : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]'
          }
          outline-none
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
