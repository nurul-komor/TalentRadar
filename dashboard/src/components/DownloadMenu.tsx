import { Menu } from '@base-ui/react/menu'
import { cn } from 'cn'
import { Icon } from './Icon'

export type DownloadFormat = 'pdf' | 'docx'

// PDF first: it's what the ATS scan prefers, so it stays the default-looking choice.
const FORMATS: Array<{ format: DownloadFormat; label: string; hint: string }> = [
  { format: 'pdf', label: 'PDF', hint: 'Preferred by most ATS' },
  { format: 'docx', label: 'Word (DOCX)', hint: 'Editable in Word / Google Docs' },
]

/**
 * Download control that offers both export formats behind a dropdown instead of
 * a format-per-button row — one trigger, PDF and DOCX inside.
 *
 * `onSelect` receives the chosen format; the caller owns the fetch and the
 * `busy` flag (the trigger disables and relabels itself while it runs).
 */
export function DownloadMenu({
  label,
  onSelect,
  busy = false,
  busyLabel = 'Preparing…',
  disabled = false,
  variant = 'primary',
  className,
}: {
  label: string
  onSelect: (format: DownloadFormat) => void
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  variant?: 'primary' | 'ghost'
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled || busy}
        className={cn(
          // Geometry mirrors the app-wide `.btn` (index.css) so this sits flush
          // next to the plain buttons it shares a row with.
          'group inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap',
          'rounded-full border border-transparent px-[18px] py-2.5 text-sm font-semibold leading-[1.2]',
          '[&_svg]:size-4',
          'transition-[transform,background,border-color,box-shadow] duration-150 ease-out',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:transform-none',
          'enabled:hover:-translate-y-px active:translate-y-px',
          'motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0',
          variant === 'primary'
            ? 'bg-[var(--indigo)] text-white shadow-[0_1px_0_rgba(255,255,255,.18)_inset,0_12px_28px_-10px_rgba(68,83,255,.55)] enabled:hover:bg-[var(--indigo-deep)]'
            : 'bg-transparent text-[var(--fg)] border-[var(--line)] enabled:hover:border-[var(--line-strong)] enabled:hover:bg-[var(--surface)]',
          className
        )}
      >
        <Icon name="download-outline" />
        <span>{busy ? busyLabel : label}</span>
        <Icon
          name="chevron-down-outline"
          // Base UI flips the trigger to data-popup-open while the menu is showing.
          className="transition-transform duration-200 group-data-[popup-open]:rotate-180 motion-reduce:transition-none"
        />
      </Menu.Trigger>

      <Menu.Portal>
        {/* Above the apply drawer (z-70) and the applications overlay (z-50) —
            the menu portals to <body>, so it must outrank both. */}
        <Menu.Positioner side="bottom" align="start" sideOffset={8} className="z-[100] outline-none">
          <Menu.Popup
            className={cn(
              'min-w-56 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg',
              'origin-[var(--transform-origin)] transition-[opacity,transform] duration-200 ease-out',
              'data-starting-style:scale-95 data-starting-style:opacity-0',
              'data-ending-style:scale-95 data-ending-style:opacity-0',
              'motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100'
            )}
          >
            {FORMATS.map(({ format, label: formatLabel, hint }) => (
              <Menu.Item
                key={format}
                onClick={() => onSelect(format)}
                className={cn(
                  'flex w-full cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-left outline-none',
                  'transition-colors duration-100 motion-reduce:transition-none',
                  'data-highlighted:bg-[var(--surface-2)]'
                )}
              >
                <Icon
                  name={format === 'pdf' ? 'document-text-outline' : 'document-outline'}
                  className="text-[var(--muted-text)]"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-[var(--fg)]">{formatLabel}</span>
                  <span className="text-xs text-[var(--muted-text)]">{hint}</span>
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
