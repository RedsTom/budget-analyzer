import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAmount, formatPercent } from '@/lib/format'
import { cn } from 'cn'

interface StatCardProps {
  label: string
  value: string
  hint?: string
  icon: ReactNode
  /** Variation relative (0.12 = +12 %). */
  delta?: number | null
  /** Variation absolue en euros, affichée à la place du pourcentage. */
  deltaAmount?: number | null
  deltaLabel?: string
  /** Une hausse est-elle une bonne nouvelle ? */
  goodWhenUp?: boolean
  accent?: 'income' | 'expense' | 'neutral'
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  delta,
  deltaAmount,
  deltaLabel = 'vs période précédente',
  goodWhenUp = true,
  accent = 'neutral',
}: StatCardProps) {
  const hasAmount = deltaAmount !== null && deltaAmount !== undefined
  const change = hasAmount ? deltaAmount : delta
  const positive = change !== null && change !== undefined && change >= 0
  const good = change === null || change === undefined ? null : positive === goodWhenUp

  return (
    <Card size="sm" className="relative overflow-hidden">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-lg',
              accent === 'income' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              accent === 'expense' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
              accent === 'neutral' && 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </span>
          {label}
        </CardDescription>
        <CardTitle className="truncate text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {change === null || change === undefined ? null : (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
              good === null && 'bg-muted text-muted-foreground',
              good === true && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              good === false && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
            )}
          >
            {positive ? (
              <ArrowUpRight className="size-3" />
            ) : change === 0 ? (
              <Minus className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {hasAmount ? formatAmount(Math.abs(change)) : formatPercent(Math.abs(change))}
          </span>
        )}
        <span className="truncate">{hint ?? deltaLabel}</span>
      </CardContent>
    </Card>
  )
}
