import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'

export function DataList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('divide-y border-t', className)}>{children}</div>
}

interface DataListRowProps {
  primary: ReactNode
  secondary?: ReactNode
  meta?: ReactNode
  amount?: ReactNode
  amountClassName?: string
  trailing?: ReactNode
  onClick?: () => void
  ariaLabel?: string
  className?: string
}

/**
 * Ligne de liste tactile. Le tableau reste la référence à partir de `md` ;
 * cette ligne remplace les colonnes horizontales sur téléphone.
 */
export function DataListRow({
  primary,
  secondary,
  meta,
  amount,
  amountClassName,
  trailing,
  onClick,
  ariaLabel,
  className,
}: DataListRowProps) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{primary}</span>
          {meta ? <span className="shrink-0">{meta}</span> : null}
        </div>
        {secondary ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{secondary}</div>
        ) : null}
      </div>
      {amount ? (
        <span
          className={cn(
            'shrink-0 text-sm font-medium whitespace-nowrap tabular-nums',
            amountClassName,
          )}
        >
          {amount}
        </span>
      ) : null}
      {trailing ?? (onClick ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      ) : null)}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted',
          className,
        )}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={cn('flex min-h-14 items-center gap-3 px-4 py-3', className)}>
      {content}
    </div>
  )
}
