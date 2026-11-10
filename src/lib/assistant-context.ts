/**
 * Construction du contexte agrégé transmis à l'assistant IA.
 *
 * Aucune donnée nominative n'est exportée : uniquement des totaux, des parts,
 * des libellés de marchands déjà affichés dans l'application et des agrégats
 * de trésorerie. Le contexte est déterministe et testable sans réseau.
 */

import type { AssistantContext } from './ai'
import {
  categoryBreakdown,
  merchantStats,
  monthlySeries,
  totalsForRange,
} from './analytics'
import { categoryById, categoryIdOf } from './categories'
import type { DateRange } from './period'
import { detectRecurring } from './recurring'
import { balanceAt, detailedCoverageSegments, runwayProjection } from './runway'
import type {
  AliasEntry,
  BudgetPlan,
  CustomAllocationMap,
  RecurringDecision,
  Transaction,
} from './types'

export interface AssistantContextInput {
  transactions: Transaction[]
  /** Période affichée par l'utilisateur (celle du sélecteur global). */
  range: DateRange
  label: string
  /** Période précédente, pour la comparaison. */
  previousRange?: DateRange | null
  aliases: Record<string, AliasEntry>
  recurringDecisions: Record<string, RecurringDecision>
  budgets?: BudgetPlan[]
  customAllocations?: CustomAllocationMap
}

/** Dépenses du mois `yyyy-mm` agrégées par catégorie effective. */
export function expensesByCategoryForMonth(
  transactions: Transaction[],
  aliases: Record<string, AliasEntry>,
  monthKey: string,
): { byCategory: Map<string, number>; total: number } {
  const byCategory = new Map<string, number>()
  let total = 0

  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== monthKey) continue
    if (transaction.amount >= 0) continue
    const categoryId = categoryIdOf(transaction, aliases)
    const amount = -transaction.amount
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + amount)
    total += amount
  }

  return { byCategory, total }
}

/**
 * Contexte complet : totaux, comparaison, catégories, marchands, série
 * mensuelle, récurrences acceptées, budgets du mois de référence, trésorerie.
 */
export function buildAssistantContext(input: AssistantContextInput): AssistantContext {
  const {
    transactions,
    range,
    label,
    previousRange,
    aliases,
    recurringDecisions,
    budgets = [],
    customAllocations = {},
  } = input

  const totals = totalsForRange(transactions, range)
  const previousTotals =
    previousRange && previousRange.start <= previousRange.end
      ? totalsForRange(transactions, previousRange)
      : null

  const categories = categoryBreakdown(transactions, range, aliases)
    .filter((slice) => slice.total > 0)
    .slice(0, 8)
    .map((slice) => ({ name: slice.name, total: slice.total, share: slice.share }))

  const merchants = merchantStats(transactions, range, aliases)
    .filter((merchant) => merchant.expenses > 0)
    .slice(0, 8)
    .map((merchant) => ({ name: merchant.label, total: merchant.expenses }))

  const monthly = monthlySeries(transactions, range).map((point) => ({
    month: point.month,
    income: point.income,
    expenses: point.expenses,
  }))

  const reference = transactions.reduce(
    (latest, transaction) => (transaction.date > latest ? transaction.date : latest),
    transactions[0]?.date ?? range.end,
  )

  // Seules les récurrences acceptées et actives comptent (règle produit).
  const series = detectRecurring(transactions, {
    reference,
    decisions: recurringDecisions,
    aliases,
  })
  const recurring = series
    .filter((item) => item.active && item.decision === 'accepted')
    .slice(0, 10)
    .map((item) => ({
      label: item.label,
      amount: item.monthlyAmount,
      intervalDays: Math.round(item.intervalDays),
      direction: item.direction,
    }))

  const monthKey = reference.slice(0, 7)
  const monthExpenses = expensesByCategoryForMonth(transactions, aliases, monthKey)
  const budgetContext = budgets.map((budget) => {
    const scoped = !budget.categoryId || budget.categoryId === 'all'
    return {
      name: budget.name,
      category: budget.categoryId ? categoryById(budget.categoryId).name : 'Toutes catégories',
      limit: budget.monthlyLimit,
      spent: scoped ? monthExpenses.total : (monthExpenses.byCategory.get(budget.categoryId!) ?? 0),
    }
  })

  const projection = runwayProjection(transactions, { now: new Date(`${reference}T00:00:00`) })
  const segments = detailedCoverageSegments(transactions, customAllocations, aliases)
  const activeSegments = segments.filter((segment) => !segment.exhausted && segment.remaining > 0.005)
  const activeFunds = activeSegments.reduce((sum, segment) => sum + segment.remaining, 0)

  return {
    periodLabel: label,
    totals: {
      income: totals.income,
      expenses: totals.expenses,
      net: totals.net,
      savingsRate: totals.savingsRate,
    },
    previous: previousTotals
      ? {
          income: previousTotals.income,
          expenses: previousTotals.expenses,
          net: previousTotals.net,
        }
      : undefined,
    categories,
    merchants,
    monthly,
    recurring,
    budgets: budgetContext,
    runway: {
      balance: balanceAt(transactions, reference),
      averageDailyExpense: projection.averageDailyExpense,
      daysLeft: projection.daysLeft,
      activeFunds,
    },
    coverage: segments
      .filter((segment) => segment.coveredAmount > 0)
      .slice(0, 8)
      .map((segment) => ({ name: segment.displayName, total: segment.coveredAmount })),
  }
}
