import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 max-sm:[&_[data-slot=button]]:min-h-10 lg:w-auto lg:justify-end lg:pt-1">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
