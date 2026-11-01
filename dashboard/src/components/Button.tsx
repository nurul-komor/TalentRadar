import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'indigo' | 'ghost'
type Size = 'default' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'btn-primary',
  indigo: 'btn-indigo',
  ghost: 'btn-ghost',
}

export function Button({
  variant = 'primary',
  size = 'default',
  className = '',
  ...props
}: ButtonProps) {
  const sizeClass = size === 'lg' ? 'btn-lg' : ''
  return (
    <button className={`btn ${VARIANT_CLASSES[variant]} ${sizeClass} ${className}`} {...props} />
  )
}
