import type { InputHTMLAttributes } from 'react'

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function Checkbox({ label, id, ...inputProps }: CheckboxProps) {
  const fieldId = id ?? inputProps.name
  return (
    <label htmlFor={fieldId} className="flex items-center gap-2 text-sm text-slate-700">
      <input
        id={fieldId}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        {...inputProps}
      />
      {label}
    </label>
  )
}
