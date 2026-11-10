import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatAmount, formatCompactAmount, formatDate } from '@/lib/format'
import { daysBetween, type DateRange } from '@/lib/period'
import type { BalancePoint } from '@/lib/runway'

interface BalanceTimelineProps {
  points: BalancePoint[]
  range: DateRange
  height?: number
}

/**
 * Timeline de solde limitée à la période globale.
 * Le graphique est volontairement statique : c'est le sélecteur de période
 * (presets / plage personnalisée) qui pilote la fenêtre affichée.
 */
export function BalanceTimeline({ points, range, height = 300 }: BalanceTimelineProps) {
  const data = useMemo(() => {
    const scoped = points.filter((point) => point.date >= range.start && point.date <= range.end)
    const previous = points.findLast((point) => point.date < range.start)
    if (!previous) return scoped
    // Point d'ouverture : solde reporté avant la période, pour ne pas démarrer à zéro.
    return [{ ...previous, date: range.start }, ...scoped]
  }, [points, range.start, range.end])

  // Sur une période courte, « oct. 26 » répété n'apporte rien : on passe au jour.
  const span = daysBetween(range.start, range.end)
  const tickLabel = (value: string) =>
    format(parseISO(value), span <= 120 ? 'd MMM' : 'MMM yy', { locale: fr })

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--color-border)"
          />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            tickFormatter={tickLabel}
          />
          <YAxis
            width={60}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            tickFormatter={(value: number) => formatCompactAmount(value)}
          />
          <RechartsTooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [formatAmount(Number(value)), 'Solde']}
            labelFormatter={(label) => formatDate(String(label))}
          />
          <ReferenceLine
            y={0}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="4 4"
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#balance-fill)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
