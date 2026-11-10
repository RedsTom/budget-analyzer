import { compareLedger } from './dedupe'
import { categoryIdOf } from './categories'
import { resolveDisplayName } from './labels'
import {
  allocationParts,
  type AliasEntry,
  type CustomAllocationMap,
  type Transaction,
} from './types'

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

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function addCoveredExpense(
  segment: DetailedCoverageSegment,
  transaction: Transaction,
  totalExpenseAmount: number,
  used: number,
  isCustom: boolean,
  categoryId: string,
  displayName: string,
): void {
  if (used <= 0.005) return
  segment.remaining = round2(segment.remaining - used)
  segment.coveredAmount = round2(segment.coveredAmount + used)
  segment.coversUntil = segment.coversUntil
    ? segment.coversUntil < transaction.date
      ? transaction.date
      : segment.coversUntil
    : transaction.date
  segment.expenses.push({
    transactionId: transaction.id,
    date: transaction.date,
    rawLabel: transaction.rawLabel,
    merchantKey: transaction.merchantKey,
    displayName,
    categoryId,
    totalExpenseAmount,
    coveredAmount: round2(used),
    isCustom,
  })
  segment.categoryTotals[categoryId] =
    (segment.categoryTotals[categoryId] ?? 0) + used
  if (segment.remaining <= 0.005) {
    segment.remaining = 0
    segment.exhausted = true
  }
}

export interface AllocationCapacity {
  expenseAmount: number
  creditAmount: number
  /** Somme des autres dépenses manuelles déjà rattachées à ce crédit. */
  otherManualDemand: number
  /** Place restante pour cette dépense une fois les autres manuelles servies. */
  available: number
  /** Part qui sera effectivement affectée à ce crédit. */
  allocated: number
  /** Part du paiement qui restera non affectée. */
  remainder: number
  blocked: boolean
  full: boolean
}

/**
 * Aucune affectation automatique n'est appliquée. Un revenu postérieur au
 * paiement est autorisé : il peut résorber un découvert ou financer une
 * dépense en attente.
 */
export function allocationCapacity(
  transactions: Transaction[],
  customAllocations: CustomAllocationMap,
  expenseId: string,
  creditId: string,
): AllocationCapacity | null {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]))
  const expense = byId.get(expenseId)
  const credit = byId.get(creditId)
  if (!expense || expense.amount >= 0 || !credit || credit.amount <= 0) return null

  const expenseAmount = -expense.amount
  let otherManualDemand = 0
  for (const [id, value] of Object.entries(customAllocations)) {
    if (id === expenseId) continue
    const other = byId.get(id)
    if (!other) continue
    for (const part of allocationParts(value, -other.amount)) {
      if (part.creditId === creditId) otherManualDemand += part.amount
    }
  }

  const available = Math.max(0, round2(credit.amount - otherManualDemand))
  const allocated = Math.min(expenseAmount, available)
  const remainder = round2(expenseAmount - allocated)
  return {
    expenseAmount: round2(expenseAmount),
    creditAmount: round2(credit.amount),
    otherManualDemand: round2(otherManualDemand),
    available,
    allocated: round2(allocated),
    remainder,
    blocked: allocated <= 0.005,
    full: remainder <= 0.005,
  }
}

/**
 * Calcul de la couverture strictement manuelle :
 * 1. Chaque paiement n'est couvert que par les parts qui lui ont été affectées.
 * 2. Un paiement peut être réparti sur plusieurs revenus (`CustomAllocationPart[]`).
 * 3. Aucun FIFO automatique : les paiements non affectés restent à traiter.
 */
export function detailedCoverageSegments(
  transactions: Transaction[],
  customAllocations: CustomAllocationMap = {},
  aliases: Record<string, AliasEntry> = {},
): DetailedCoverageSegment[] {
  const ledger = sortLedger(transactions)
  const segments: DetailedCoverageSegment[] = []
  const segmentMap = new Map<string, DetailedCoverageSegment>()

  // Pré-remplir segmentMap pour permettre les affectations manuelles ciblées,
  // y compris vers un crédit qui apparaît plus tard dans le grand livre.
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
      segments.push(seg)
    }
  }

  // Plus de FIFO : seules les affectations manuelles, éventuellement
  // réparties sur plusieurs crédits, couvrent les paiements.
  for (const tx of ledger) {
    if (tx.amount >= 0) continue
    const totalExpense = -tx.amount
    const parts = allocationParts(customAllocations[tx.id], totalExpense)
    if (parts.length === 0) continue

    const catId = categoryIdOf(tx, aliases)
    const displayName = resolveDisplayName(tx, aliases)
    for (const part of parts) {
      const target = segmentMap.get(part.creditId)
      if (!target) continue
      const used = Math.min(target.remaining, part.amount)
      addCoveredExpense(target, tx, totalExpense, used, true, catId, displayName)
    }
  }

  // Fusionne les parts d'une même dépense tombées sur le même crédit.
  for (const seg of segments) {
    const merged = new Map<string, CoveredExpense>()
    for (const expense of seg.expenses) {
      const existing = merged.get(expense.transactionId)
      if (existing) {
        existing.coveredAmount = round2(existing.coveredAmount + expense.coveredAmount)
        existing.isCustom = existing.isCustom || expense.isCustom
      } else {
        merged.set(expense.transactionId, { ...expense })
      }
    }
    seg.expenses = [...merged.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.transactionId.localeCompare(b.transactionId),
    )
  }

  // Post-traitement : calcul des durées et arrondis finaux.
  const nowIso = new Date().toISOString().slice(0, 10)
  for (const seg of segments) {
    const endPoint = seg.coversUntil ?? (seg.exhausted ? seg.date : nowIso)
    seg.durationDays = daysBetween(seg.date, endPoint)
    seg.remaining = round2(seg.remaining)
    seg.coveredAmount = round2(seg.coveredAmount)
  }

  return segments
}

export interface PaymentAllocationStatus {
  transaction: Transaction
  totalAmount: number
  assignedAmount: number
  remainingAmount: number
  parts: { creditId: string; amount: number }[]
  status: 'todo' | 'partial' | 'done'
}

/**
 * État de traitement de chaque paiement (toutes les dépenses, y compris les
 * virements). Sert à la file « traitement 1 par 1 » : aucun paiement n'est
 * couvert sans une affectation manuelle.
 */
export function paymentAllocationStatuses(
  transactions: Transaction[],
  customAllocations: CustomAllocationMap = {},
  aliases: Record<string, AliasEntry> = {},
): PaymentAllocationStatus[] {
  const segments = detailedCoverageSegments(transactions, customAllocations, aliases)
  const assigned = new Map<string, Map<string, number>>()
  for (const segment of segments) {
    for (const expense of segment.expenses) {
      const byCredit = assigned.get(expense.transactionId) ?? new Map<string, number>()
      byCredit.set(
        segment.creditId,
        round2((byCredit.get(segment.creditId) ?? 0) + expense.coveredAmount),
      )
      assigned.set(expense.transactionId, byCredit)
    }
  }

  return sortLedger(transactions)
    .filter((transaction) => transaction.amount < 0)
    .map((transaction) => {
      const totalAmount = round2(-transaction.amount)
      const byCredit = assigned.get(transaction.id)
      const parts = byCredit
        ? [...byCredit.entries()].map(([creditId, amount]) => ({ creditId, amount }))
        : []
      const assignedAmount = round2(
        Math.min(totalAmount, parts.reduce((sum, part) => sum + part.amount, 0)),
      )
      const remainingAmount = round2(totalAmount - assignedAmount)
      const status: PaymentAllocationStatus['status'] =
        remainingAmount <= 0.005 ? 'done' : assignedAmount > 0.005 ? 'partial' : 'todo'
      return {
        transaction,
        totalAmount,
        assignedAmount,
        remainingAmount,
        parts,
        status,
      }
    })
}

export interface CoverageAvailability {
  /** Somme brute des restes de crédits, avant déficit antérieur. */
  grossRemaining: number
  /** Solde bancaire courant. */
  balance: number
  /** Fonds réellement disponibles, bornés par le solde. */
  available: number
  /** Part des crédits actifs absorbée par un découvert antérieur. */
  absorbedDeficit: number
  /** Reste affichable par crédit après absorption du déficit. */
  availableByCredit: Record<string, number>
  /** Montant du déficit absorbé par chaque crédit. */
  deficitByCredit: Record<string, number>
}

/**
 * Les crédits couvrent les dépenses postérieures, mais un découvert antérieur
 * reste dans le solde bancaire. Sans cette correction, la somme des restes de
 * crédits peut dépasser largement le solde réel (ex. nouveau salaire versé
 * après un découvert). On impute le déficit aux crédits actifs les plus anciens.
 */
export function coverageAvailability(
  segments: DetailedCoverageSegment[],
  balance: number,
): CoverageAvailability {
  const active = segments
    .filter((segment) => segment.remaining > 0.005)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.creditTransaction.order - b.creditTransaction.order,
    )
  const grossRemaining = round2(
    active.reduce((sum, segment) => sum + segment.remaining, 0),
  )
  const target = Math.max(0, Math.min(grossRemaining, round2(balance)))
  const absorbedDeficit = round2(grossRemaining - target)

  const availableByCredit: Record<string, number> = {}
  const deficitByCredit: Record<string, number> = {}
  let left = absorbedDeficit
  for (const segment of active) {
    const absorbed = Math.min(segment.remaining, left)
    availableByCredit[segment.creditId] = round2(segment.remaining - absorbed)
    deficitByCredit[segment.creditId] = round2(absorbed)
    left = round2(left - absorbed)
  }

  // Reliquat d'arrondi éventuel : l'imputer au dernier crédit disponible.
  if (left > 0.005) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const id = active[index].creditId
      const available = availableByCredit[id] ?? 0
      if (available <= 0.005) continue
      const correction = Math.min(available, left)
      availableByCredit[id] = round2(available - correction)
      deficitByCredit[id] = round2((deficitByCredit[id] ?? 0) + correction)
      left = round2(left - correction)
      if (left <= 0.005) break
    }
  }

  return {
    grossRemaining,
    balance: round2(balance),
    available: round2(target),
    absorbedDeficit,
    availableByCredit,
    deficitByCredit,
  }
}

/**
 * Couverture par les affectations manuelles : chaque crédit ne porte que les
 * paiements qui lui ont été explicitement rattachés.
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
 * Ne remplace pas les segments de couverture, c'est une estimation « à ce rythme ».
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
