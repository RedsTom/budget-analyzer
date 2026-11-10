import { format, getISODay, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { categoryById, categoryIdOf, type CategoryId } from './categories'
import { formatAmount, formatDate, formatPercent } from './format'
import { resolveDisplayName } from './labels'
import { inRange, rangeDays, rangeMonths, type DateRange } from './period'
import { sortLedger } from './runway'
import type { AliasEntry, Transaction } from './types'

export interface Totals {
  income: number
  expenses: number
  net: number
  count: number
  incomeCount: number
  expenseCount: number
  averageExpense: number
  averageIncome: number
  savingsRate: number | null
}

export function summarize(transactions: Transaction[]): Totals {
  let income = 0
  let expenses = 0
  let incomeCount = 0
  let expenseCount = 0

  for (const transaction of transactions) {
    if (transaction.amount < 0) {
      expenses += -transaction.amount
      expenseCount++
    } else if (transaction.amount > 0) {
      income += transaction.amount
      incomeCount++
    }
  }

  return {
    income,
    expenses,
    net: income - expenses,
    count: transactions.length,
    incomeCount,
    expenseCount,
    averageExpense: expenseCount > 0 ? expenses / expenseCount : 0,
    averageIncome: incomeCount > 0 ? income / incomeCount : 0,
    savingsRate: income > 0 ? (income - expenses) / income : null,
  }
}

export function transactionsInRange(
  transactions: Transaction[],
  range: DateRange,
): Transaction[] {
  return sortLedger(transactions.filter((transaction) => inRange(transaction, range)))
}

export function totalsForRange(
  transactions: Transaction[],
  range: DateRange,
): Totals {
  return summarize(transactionsInRange(transactions, range))
}

export interface MonthlyPoint {
  month: string
  label: string
  income: number
  expenses: number
  net: number
  count: number
}

/** Série mensuelle complète : les mois sans mouvement restent à zéro. */
export function monthlySeries(
  transactions: Transaction[],
  range: DateRange,
): MonthlyPoint[] {
  const buckets = new Map<string, MonthlyPoint>()

  for (const month of rangeMonths(range)) {
    buckets.set(month, {
      month,
      label: format(parseISO(`${month}-01`), 'MMM yy', { locale: fr }),
      income: 0,
      expenses: 0,
      net: 0,
      count: 0,
    })
  }

  for (const transaction of transactions) {
    if (!inRange(transaction, range)) continue
    const bucket = buckets.get(transaction.date.slice(0, 7))
    if (!bucket) continue

    bucket.count++
    if (transaction.amount < 0) bucket.expenses += -transaction.amount
    else bucket.income += transaction.amount
    bucket.net = bucket.income - bucket.expenses
  }

  return [...buckets.values()]
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  // Base quasi nulle : la variation en pourcentage n'a pas de sens lisible.
  if (Math.abs(previous) < 1) return null
  return (current - previous) / Math.abs(previous)
}

export interface MerchantStat {
  merchantKey: string
  label: string
  categoryId: CategoryId
  count: number
  expenses: number
  income: number
  net: number
  averageExpense: number
  firstDate: string
  lastDate: string
  volume: number
}

export function merchantStats(
  transactions: Transaction[],
  range: DateRange,
  aliases: Record<string, AliasEntry>,
): MerchantStat[] {
  interface Accumulator {
    merchantKey: string
    count: number
    expenses: number
    expenseCount: number
    income: number
    firstDate: string
    lastDate: string
    latest: Transaction
  }

  const accumulators = new Map<string, Accumulator>()

  for (const transaction of transactions) {
    if (!inRange(transaction, range) || transaction.amount === 0) continue

    const existing = accumulators.get(transaction.merchantKey)
    if (!existing) {
      accumulators.set(transaction.merchantKey, {
        merchantKey: transaction.merchantKey,
        count: 1,
        expenses: transaction.amount < 0 ? -transaction.amount : 0,
        expenseCount: transaction.amount < 0 ? 1 : 0,
        income: transaction.amount > 0 ? transaction.amount : 0,
        firstDate: transaction.date,
        lastDate: transaction.date,
        latest: transaction,
      })
      continue
    }

    existing.count++
    if (transaction.amount < 0) {
      existing.expenses += -transaction.amount
      existing.expenseCount++
    } else {
      existing.income += transaction.amount
    }
    if (transaction.date < existing.firstDate) existing.firstDate = transaction.date
    if (transaction.date >= existing.lastDate) {
      existing.lastDate = transaction.date
      existing.latest = transaction
    }
  }

  return [...accumulators.values()]
    .map((accumulator) => ({
      merchantKey: accumulator.merchantKey,
      label: resolveDisplayName(accumulator.latest, aliases),
      categoryId: categoryIdOf(accumulator.latest, aliases),
      count: accumulator.count,
      expenses: accumulator.expenses,
      income: accumulator.income,
      net: accumulator.income - accumulator.expenses,
      averageExpense:
        accumulator.expenseCount > 0
          ? accumulator.expenses / accumulator.expenseCount
          : 0,
      firstDate: accumulator.firstDate,
      lastDate: accumulator.lastDate,
      volume: accumulator.expenses + accumulator.income,
    }))
    .sort((a, b) => b.volume - a.volume)
}

export interface CategorySlice {
  id: CategoryId
  name: string
  color: string
  total: number
  count: number
  share: number
}

export function categoryBreakdown(
  transactions: Transaction[],
  range: DateRange,
  aliases: Record<string, AliasEntry>,
  direction: 'expense' | 'income' = 'expense',
): CategorySlice[] {
  const buckets = new Map<CategoryId, CategorySlice>()
  let grandTotal = 0

  for (const transaction of transactions) {
    if (!inRange(transaction, range)) continue
    const matches = direction === 'expense' ? transaction.amount < 0 : transaction.amount > 0
    if (!matches) continue

    const id = categoryIdOf(transaction, aliases)
    const category = categoryById(id)
    const total = Math.abs(transaction.amount)
    grandTotal += total

    const bucket = buckets.get(id) ?? {
      id,
      name: category.name,
      color: category.color,
      total: 0,
      count: 0,
      share: 0,
    }
    bucket.total += total
    bucket.count++
    buckets.set(id, bucket)
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      share: grandTotal > 0 ? bucket.total / grandTotal : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

export interface WeekdayPoint {
  weekday: number
  label: string
  total: number
  count: number
}

const WEEKDAY_LABELS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

export function weekdayBreakdown(
  transactions: Transaction[],
  range: DateRange,
): WeekdayPoint[] {
  const points: WeekdayPoint[] = WEEKDAY_LABELS.map((label, index) => ({
    weekday: index + 1,
    label,
    total: 0,
    count: 0,
  }))

  for (const transaction of transactions) {
    if (!inRange(transaction, range) || transaction.amount >= 0) continue
    const point = points[getISODay(parseISO(transaction.date)) - 1]
    point.total += -transaction.amount
    point.count++
  }

  return points
}

export interface Highlight {
  id: string
  title: string
  value: string
  hint: string
}

/** Quelques faits saillants de la période, prêts à afficher. */
export function highlights(
  transactions: Transaction[],
  range: DateRange,
  aliases: Record<string, AliasEntry>,
): Highlight[] {
  const scoped = transactionsInRange(transactions, range)
  const totals = summarize(scoped)
  const items: Highlight[] = []

  const biggestExpense = scoped
    .filter((transaction) => transaction.amount < 0)
    .reduce<Transaction | null>(
      (best, transaction) =>
        !best || transaction.amount < best.amount ? transaction : best,
      null,
    )

  if (biggestExpense) {
    items.push({
      id: 'biggest-expense',
      title: 'Plus grosse dépense',
      value: formatAmount(-biggestExpense.amount),
      hint: `${resolveDisplayName(biggestExpense, aliases)} · ${formatDate(biggestExpense.date)}`,
    })
  }

  const biggestIncome = scoped
    .filter((transaction) => transaction.amount > 0)
    .reduce<Transaction | null>(
      (best, transaction) =>
        !best || transaction.amount > best.amount ? transaction : best,
      null,
    )

  if (biggestIncome) {
    items.push({
      id: 'biggest-income',
      title: 'Plus grosse entrée',
      value: formatAmount(biggestIncome.amount),
      hint: `${resolveDisplayName(biggestIncome, aliases)} · ${formatDate(biggestIncome.date)}`,
    })
  }

  if (totals.savingsRate !== null) {
    items.push({
      id: 'savings-rate',
      title: 'Taux d’épargne',
      value: formatPercent(totals.savingsRate),
      hint:
        totals.net >= 0
          ? `${formatAmount(totals.net)} conservés sur la période`
          : `${formatAmount(-totals.net)} de plus dépensés qu’encaissés`,
    })
  }

  if (totals.expenseCount > 0) {
    items.push({
      id: 'average-basket',
      title: 'Dépense moyenne',
      value: formatAmount(totals.averageExpense),
      hint: `${totals.expenseCount} dépenses · ${rangeDays(range)} jours`,
    })
  }

  const byDay = new Map<string, number>()
  for (const transaction of scoped) {
    if (transaction.amount >= 0) continue
    byDay.set(transaction.date, (byDay.get(transaction.date) ?? 0) + -transaction.amount)
  }
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]
  if (busiest) {
    items.push({
      id: 'busiest-day',
      title: 'Journée la plus dépensière',
      value: formatAmount(busiest[1]),
      hint: formatDate(busiest[0]),
    })
  }

  const merchants = merchantStats(transactions, range, aliases)
  const topMerchant = merchants[0]
  if (topMerchant) {
    items.push({
      id: 'top-merchant',
      title: 'Premier marchand',
      value: topMerchant.label,
      hint: `${formatAmount(topMerchant.expenses + topMerchant.income)} sur ${topMerchant.count} mouvements`,
    })
  }

  return items
}

export function shareOfTotal(value: number, total: number): number {
  return total > 0 ? value / total : 0
}
