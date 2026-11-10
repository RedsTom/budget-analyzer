import { compareLedger } from './dedupe'
import { categoryIdOf } from './categories'
import { resolveDisplayName } from './labels'
import type { AliasEntry, CustomAllocationMap, Transaction } from './types'

export interface BalancePoint {
  date: string
  balance: number
  amount: number
  order: number
}

export function sortLedger(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(compareLedger)
}

/**
 * Série de soldes pour la timeline. Le solde bancaire est utilisé tel quel :
 * il est continu dans l'ordre du fichier (vérifié sur l'export complet).
 */
export function balancePoints(transactions: Transaction[]): BalancePoint[] {
  return sortLedger(transactions).map((transaction) => ({
    date: transaction.date,
    balance: transaction.solde,
    amount: transaction.amount,
    order: transaction.order,
  }))
}

/** Solde bancaire à la fin d'une date donnée (borne incluse). */
export function balanceAt(transactions: Transaction[], date: string): number {
  const ledger = sortLedger(transactions)
  let balance = 0
  for (const transaction of ledger) {
    if (transaction.date > date) break
    balance = transaction.solde
  }
  return balance
}

/** Retourne les index où le solde ne suit pas le mouvement précédent. */
export function balanceChainBreaks(transactions: Transaction[]): number[] {
  const ledger = sortLedger(transactions)
  const breaks: number[] = []

  for (let index = 1; index < ledger.length; index++) {
    const previous = ledger[index - 1]
    if (Math.abs(previous.solde + ledger[index].amount - ledger[index].solde) > 0.011) {
      breaks.push(index)
    }
  }

  return breaks
}

export interface CoverageSegment {
  creditId: string
  date: string
  amount: number
  coveredAmount: number
  remaining: number
  exhausted: boolean
  /** Dernière date de dépense couverte par ce crédit, ou null si aucune. */
  coversUntil: string | null
}

export interface CoveredExpense {
  transactionId: string
  date: string
  rawLabel: string
  merchantKey: string
  displayName: string
  categoryId: string
  totalExpenseAmount: number
  coveredAmount: number
  isCustom: boolean
}

export interface DetailedCoverageSegment {
  creditId: string
  creditTransaction: Transaction
  displayName: string
  date: string
  amount: number
  coveredAmount: number
  remaining: number
  exhausted: boolean
  coversUntil: string | null
  durationDays: number
  expenses: CoveredExpense[]
  categoryTotals: Record<string, number>
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)))
}

/**
 * Calcul complet de la couverture :
 * 1. Priorité aux affectations manuelles (customAllocations : expenseId -> creditId)
 * 2. Déversement FIFO chronologique pour les dépenses restantes.
 * 3. Ventilation des catégories et historique détaillé par revenu.
 */
export function detailedCoverageSegments(
  transactions: Transaction[],
  customAllocations: CustomAllocationMap = {},
  aliases: Record<string, AliasEntry> = {},
): DetailedCoverageSegment[] {
  const ledger = sortLedger(transactions)
  const segments: DetailedCoverageSegment[] = []
  const segmentMap = new Map<string, DetailedCoverageSegment>()

  // Pré-remplir segmentMap pour permettre les affectations manuelles ciblées
  for (const tx of ledger) {
    if (tx.amount > 0) {
      const seg: DetailedCoverageSegment = {
        creditId: tx.id,
        creditTransaction: tx,
        displayName: resolveDisplayName(tx, aliases),
        date: tx.date,
        amount: tx.amount,
        coveredAmount: 0,
        remaining: tx.amount,
        exhausted: false,
        coversUntil: null,
        durationDays: 0,
        expenses: [],
        categoryTotals: {},
      }
      segmentMap.set(tx.id, seg)
    }
  }

  // Traitement séquentiel dans l'ordre chronologique du grand livre
  let cursor = 0

  for (const tx of ledger) {
    if (tx.amount > 0) {
      // Le crédit entre dans la file des seaux disponibles pour le FIFO
      const seg = segmentMap.get(tx.id)!
      segments.push(seg)
      continue
    }

    if (tx.amount === 0) continue

    const totalExpense = -tx.amount
    let toCover = totalExpense
    const catId = categoryIdOf(tx, aliases)
    const displayName = resolveDisplayName(tx, aliases)

    // A. Affectation manuelle personnalisée prioritaire (si l'utilisateur a ciblé un crédit spécifique)
    const customCreditId = customAllocations[tx.id]
    if (customCreditId && segmentMap.has(customCreditId)) {
      const targetSeg = segmentMap.get(customCreditId)!
      if (targetSeg.remaining > 0.005) {
        const used = Math.min(targetSeg.remaining, toCover)
        targetSeg.remaining -= used
        targetSeg.coveredAmount += used
        targetSeg.coversUntil = targetSeg.coversUntil
          ? targetSeg.coversUntil < tx.date ? tx.date : targetSeg.coversUntil
          : tx.date

        targetSeg.expenses.push({
          transactionId: tx.id,
          date: tx.date,
          rawLabel: tx.rawLabel,
          merchantKey: tx.merchantKey,
          displayName,
          categoryId: catId,
          totalExpenseAmount: totalExpense,
          coveredAmount: Math.round(used * 100) / 100,
          isCustom: true,
        })

        targetSeg.categoryTotals[catId] = (targetSeg.categoryTotals[catId] ?? 0) + used
        toCover -= used

        if (targetSeg.remaining <= 0.005) {
          targetSeg.remaining = 0
          targetSeg.exhausted = true
        }
      }
    }

    // B. Déversement FIFO classique sur les crédits arrivés jusqu'à cette date
    while (toCover > 0.005 && cursor < segments.length) {
      const seg = segments[cursor]
      if (seg.remaining <= 0.005) {
        seg.remaining = 0
        seg.exhausted = true
        cursor++
        continue
      }

      const used = Math.min(seg.remaining, toCover)
      seg.remaining -= used
      seg.coveredAmount += used
      seg.coversUntil = seg.coversUntil
        ? seg.coversUntil < tx.date ? tx.date : seg.coversUntil
        : tx.date

      seg.expenses.push({
        transactionId: tx.id,
        date: tx.date,
        rawLabel: tx.rawLabel,
        merchantKey: tx.merchantKey,
        displayName,
        categoryId: catId,
        totalExpenseAmount: totalExpense,
        coveredAmount: Math.round(used * 100) / 100,
        isCustom: false,
      })

      seg.categoryTotals[catId] = (seg.categoryTotals[catId] ?? 0) + used
      toCover -= used

      if (seg.remaining <= 0.005) {
        seg.remaining = 0
        seg.exhausted = true
        cursor++
      }
    }
  }

  // 3. Post-traitement : calcul des durées
  const nowIso = new Date().toISOString().slice(0, 10)
  for (const seg of segments) {
    const endPoint = seg.coversUntil ?? (seg.exhausted ? seg.date : nowIso)
    seg.durationDays = daysBetween(seg.date, endPoint)
    seg.remaining = Math.round(seg.remaining * 100) / 100
    seg.coveredAmount = Math.round(seg.coveredAmount * 100) / 100
  }

  return segments
}

/**
 * Couverture FIFO : chaque crédit remplit un « seau » consommé par les dépenses
 * suivantes. Répond à « ce positif tient jusqu'à quand ? ».
 */
export function coverageSegments(
  transactions: Transaction[],
  customAllocations: CustomAllocationMap = {},
  aliases: Record<string, AliasEntry> = {},
): CoverageSegment[] {
  const detailed = detailedCoverageSegments(transactions, customAllocations, aliases)
  return detailed.map((d) => ({
    creditId: d.creditId,
    date: d.date,
    amount: d.amount,
    coveredAmount: d.coveredAmount,
    remaining: d.remaining,
    exhausted: d.exhausted,
    coversUntil: d.coversUntil,
  }))
}

export interface RunwayProjection {
  balance: number
  averageDailyExpense: number
  daysLeft: number | null
  endsOn: string | null
  windowDays: number
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + Math.ceil(days))
  return result
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Projection simple : solde courant / dépense moyenne par jour sur la fenêtre.
 * Ne remplace pas les segments FIFO, c'est une estimation « à ce rythme ».
 */
export function runwayProjection(
  transactions: Transaction[],
  options: { now?: Date; lookbackDays?: number } = {},
): RunwayProjection {
  const now = options.now ?? new Date()
  const windowDays = options.lookbackDays ?? 90
  const ledger = sortLedger(transactions)
  const balance = ledger.at(-1)?.solde ?? 0

  const start = new Date(now)
  start.setDate(start.getDate() - windowDays)
  const startIso = toIsoDate(start)

  let expenses = ledger
    .filter((transaction) => transaction.date >= startIso && transaction.amount < 0)
    .reduce((total, transaction) => total - transaction.amount, 0)

  if (expenses === 0) {
    expenses = ledger
      .filter((transaction) => transaction.amount < 0)
      .reduce((total, transaction) => total - transaction.amount, 0)
  }

  const averageDailyExpense = expenses / windowDays
  if (averageDailyExpense <= 0) {
    return { balance, averageDailyExpense: 0, daysLeft: null, endsOn: null, windowDays }
  }

  const daysLeft = Math.max(0, balance / averageDailyExpense)
  return {
    balance,
    averageDailyExpense,
    daysLeft,
    endsOn: balance > 0 ? toIsoDate(addDays(now, daysLeft)) : toIsoDate(now),
    windowDays,
  }
}

export interface MonthlyTotal {
  month: string
  expenses: number
  income: number
  net: number
}

export function monthlyTotals(transactions: Transaction[]): MonthlyTotal[] {
  const totals = new Map<string, MonthlyTotal>()

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7)
    const current = totals.get(month) ?? { month, expenses: 0, income: 0, net: 0 }
    if (transaction.amount < 0) current.expenses += -transaction.amount
    else current.income += transaction.amount
    current.net = current.income - current.expenses
    totals.set(month, current)
  }

  return [...totals.values()].sort((a, b) => a.month.localeCompare(b.month))
}
