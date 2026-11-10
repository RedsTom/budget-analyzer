import {
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Transaction } from './types'

export type PeriodPreset =
  | '30d'
  | '90d'
  | '6m'
  | '12m'
  | '24m'
  | 'all'
  | 'custom'

export interface DateRange {
  /** Borne incluse, ISO `yyyy-mm-dd`. */
  start: string
  /** Borne incluse, ISO `yyyy-mm-dd`. */
  end: string
}

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: '30d', label: '30 j' },
  { id: '90d', label: '90 j' },
  { id: '6m', label: '6 mois' },
  { id: '12m', label: '12 mois' },
  { id: '24m', label: '24 mois' },
  { id: 'all', label: 'Tout' },
]

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function toDate(iso: string): Date {
  return parseISO(iso)
}

export function daysBetween(start: string, end: string): number {
  return differenceInCalendarDays(toDate(end), toDate(start))
}

/** Dernière date du jeu de données, ou aujourd'hui si le coffre est vide. */
export function referenceDate(transactions: Transaction[]): string {
  let latest: string | null = null
  for (const transaction of transactions) {
    if (!latest || transaction.date > latest) latest = transaction.date
  }
  return latest ?? todayIso()
}

export function datasetRange(transactions: Transaction[]): DateRange {
  if (transactions.length === 0) {
    const today = todayIso()
    return { start: today, end: today }
  }

  let start = transactions[0].date
  let end = transactions[0].date
  for (const transaction of transactions) {
    if (transaction.date < start) start = transaction.date
    if (transaction.date > end) end = transaction.date
  }
  return { start, end }
}

function clampRange(range: DateRange, bounds: DateRange): DateRange {
  const start = range.start < bounds.start ? bounds.start : range.start
  const end = range.end > bounds.end ? bounds.end : range.end
  return start > end ? { start: end, end } : { start, end }
}

/**
 * Convertit un preset en intervalle concret, ancré sur la dernière date du
 * jeu de données (et non sur l'horloge) pour ne jamais analyser une fenêtre vide.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  transactions: Transaction[],
  custom?: DateRange | null,
): DateRange {
  const bounds = datasetRange(transactions)
  const reference = toDate(referenceDate(transactions))

  switch (preset) {
    case '30d':
      return clampRange({ start: format(subDays(reference, 29), 'yyyy-MM-dd'), end: bounds.end }, bounds)
    case '90d':
      return clampRange({ start: format(subDays(reference, 89), 'yyyy-MM-dd'), end: bounds.end }, bounds)
    case '6m':
      return clampRange(
        { start: format(startOfMonth(subMonths(reference, 5)), 'yyyy-MM-dd'), end: bounds.end },
        bounds,
      )
    case '12m':
      return clampRange(
        { start: format(startOfMonth(subMonths(reference, 11)), 'yyyy-MM-dd'), end: bounds.end },
        bounds,
      )
    case '24m':
      return clampRange(
        { start: format(startOfMonth(subMonths(reference, 23)), 'yyyy-MM-dd'), end: bounds.end },
        bounds,
      )
    case 'custom':
      return custom ? clampRange(custom, bounds) : bounds
    case 'all':
      return bounds
  }
}

/** Période équivalente juste avant, pour comparer deux fenêtres de même durée. */
export function previousPeriod(range: DateRange): DateRange {
  const days = Math.max(1, daysBetween(range.start, range.end) + 1)
  const start = subDays(toDate(range.start), days)
  return { start: format(start, 'yyyy-MM-dd'), end: format(subDays(toDate(range.start), 1), 'yyyy-MM-dd') }
}

export function inRange(transaction: { date: string }, range: DateRange): boolean {
  return transaction.date >= range.start && transaction.date <= range.end
}

export function periodLabel(range: DateRange, preset: PeriodPreset): string {
  if (preset === 'all') return 'Tout l’historique'
  if (range.start === range.end) {
    return format(toDate(range.start), 'd MMM yyyy', { locale: fr })
  }
  return `${format(toDate(range.start), 'd MMM yyyy', { locale: fr })} → ${format(
    toDate(range.end),
    'd MMM yyyy',
    { locale: fr },
  )}`
}

export function rangeMonths(range: DateRange): string[] {
  const months: string[] = []
  let cursor = startOfMonth(toDate(range.start))
  const end = startOfMonth(toDate(range.end))

  while (cursor <= end) {
    months.push(format(cursor, 'yyyy-MM'))
    cursor = addMonths(cursor, 1)
  }

  return months
}

export function rangeDays(range: DateRange): number {
  return Math.max(1, daysBetween(range.start, range.end) + 1)
}
