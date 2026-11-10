import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  format,
  getISODay,
  parseISO,
} from 'date-fns'
import { categoryIdOf, type CategoryId } from './categories'
import { resolveDisplayName } from './labels'
import { referenceDate } from './period'
import type { AliasEntry, RecurringDecision, Transaction } from './types'

export type RecurringStatus = RecurringDecision | 'pending'

export type RecurrenceFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Hebdomadaire',
  biweekly: 'Toutes les 2 semaines',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  yearly: 'Annuel',
}

export const FREQUENCY_SHORT: Record<RecurrenceFrequency, string> = {
  weekly: '7 j',
  biweekly: '14 j',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  yearly: 'Annuel',
}

export const FREQUENCY_DAYS: Record<RecurrenceFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  yearly: 365.25,
}

/**
 * Tolérance sur la date attendue. Les banques décalent souvent un prélèvement
 * du week-end ou d'un jour férié de 1 à 3 jours ouvrés, et les mois font
 * 28 à 31 jours : le calcul mensuel se fait donc en mois calendaires.
 */
const CADENCE_TOLERANCE: Record<RecurrenceFrequency, number> = {
  weekly: 3,
  biweekly: 4,
  monthly: 5,
  quarterly: 12,
  yearly: 25,
}

const MIN_OCCURRENCES: Record<RecurrenceFrequency, number> = {
  weekly: 4,
  biweekly: 3,
  monthly: 3,
  quarterly: 3,
  yearly: 2,
}

export interface RecurringSeries {
  id: string
  merchantKey: string
  label: string
  categoryId: CategoryId
  direction: 'expense' | 'income'
  frequency: RecurrenceFrequency
  /** Intervalle médian réel entre deux occurrences, en jours. */
  intervalDays: number
  occurrences: number
  /** Dates distinctes d'occurrence, ordre chronologique. */
  dates: string[]
  /** Montant moyen par occurrence (valeur absolue). */
  averageAmount: number
  /** Montant de la dernière occurrence (valeur absolue). */
  lastAmount: number
  /** Équivalent mensuel lissé, valeur absolue. */
  monthlyAmount: number
  totalAmount: number
  nextDate: string
  daysUntilNext: number
  overdue: boolean
  /** Faux si la série est terminée ou remplacée par une série plus récente. */
  active: boolean
  daysSinceLast: number
  /** 0 → 1 : régularité des dates, stabilité des montants, profondeur d'historique. */
  confidence: number
  lastDate: string
  /** Décision de l'utilisateur ; `pending` tant qu'il n'a pas tranché. */
  decision: RecurringStatus
}

export interface RecurringOptions {
  /** Date de référence pour calculer l'échéance à venir. */
  reference?: string
  /** Décisions de l'utilisateur par identifiant de série (absence = en attente). */
  decisions?: Record<string, RecurringDecision>
  aliases?: Record<string, AliasEntry>
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function frequencyOf(interval: number): RecurrenceFrequency | null {
  if (interval >= 5 && interval <= 10) return 'weekly'
  if (interval >= 11 && interval <= 20) return 'biweekly'
  if (interval >= 24 && interval <= 40) return 'monthly'
  if (interval >= 75 && interval <= 110) return 'quarterly'
  if (interval >= 320 && interval <= 410) return 'yearly'
  return null
}

/** Fréquence la plus votée par les intervalles, pour ne pas être piégé par un trou. */
function pickFrequency(intervals: number[]): RecurrenceFrequency | null {
  const votes = new Map<RecurrenceFrequency, number>()
  for (const interval of intervals) {
    const frequency = frequencyOf(interval)
    if (!frequency) continue
    votes.set(frequency, (votes.get(frequency) ?? 0) + 1)
  }

  let best: RecurrenceFrequency | null = null
  let bestVotes = 0
  for (const [frequency, count] of votes) {
    if (count > bestVotes) {
      best = frequency
      bestVotes = count
    }
  }
  return best
}

/** Prochaine occurrence attendue, en mois calendaires pour mensuel et au-delà. */
function expectedNext(date: string, frequency: RecurrenceFrequency): Date {
  const parsed = parseISO(date)
  switch (frequency) {
    case 'weekly':
      return addDays(parsed, 7)
    case 'biweekly':
      return addDays(parsed, 14)
    case 'monthly':
      return addMonths(parsed, 1)
    case 'quarterly':
      return addMonths(parsed, 3)
    case 'yearly':
      return addYears(parsed, 1)
  }
}

function onCadence(
  previous: string,
  next: string,
  frequency: RecurrenceFrequency,
): boolean {
  const actual = differenceInCalendarDays(parseISO(next), parseISO(previous))
  const expected = differenceInCalendarDays(
    expectedNext(previous, frequency),
    parseISO(previous),
  )
  return Math.abs(actual - expected) <= CADENCE_TOLERANCE[frequency]
}

/** Les abonnements sont stables au centime : 0,2 € ou 0,5 % absorbe les arrondis. */
function onSameAmount(reference: number, amount: number): boolean {
  return Math.abs(amount - reference) <= Math.max(0.2, reference * 0.005)
}

/** Les débits du week-end sont généralement reportés au lundi suivant. */
function nextBusinessDay(date: Date): Date {
  const day = getISODay(date)
  if (day === 6) return addDays(date, 2)
  if (day === 7) return addDays(date, 1)
  return date
}

interface DateBucket {
  date: string
  amount: number
  latest: Transaction
}

/** Une échéance manquée coupe la série : la reprise formera une nouvelle série. */
function splitByCadence(
  buckets: DateBucket[],
  frequency: RecurrenceFrequency,
): DateBucket[][] {
  const runs: DateBucket[][] = []
  let current: DateBucket[] = []
  for (const bucket of buckets) {
    if (current.length === 0) {
      current.push(bucket)
      continue
    }
    const previous = current[current.length - 1]
    const gap = differenceInCalendarDays(
      parseISO(bucket.date),
      parseISO(previous.date),
    )
    const expected = differenceInCalendarDays(
      expectedNext(previous.date, frequency),
      parseISO(previous.date),
    )
    // Transaction ponctuelle du même marchand entre deux échéances : elle ne
    // fait pas partie de la série (ex. virement exceptionnel).
    if (gap < expected * 0.6) continue
    if (onCadence(previous.date, bucket.date, frequency)) {
      current.push(bucket)
      continue
    }
    runs.push(current)
    current = [bucket]
  }
  if (current.length > 0) runs.push(current)
  return runs
}

/**
 * Coupe la série quand le montant change durablement.
 *
 * Un montant isolé (prorata, régularisation, remise) est absorbé : il faut
 * deux occurrences consécutives au nouveau montant pour ouvrir une série.
 * Une occurrence isolée juste avant le changement est rattachée à la
 * nouvelle série, pour ne pas perdre la reprise après une régularisation.
 */
function splitByAmount(buckets: DateBucket[]): DateBucket[][] {
  const segments: DateBucket[][] = []
  let current: DateBucket[] = [buckets[0]]
  let reference = buckets[0].amount

  for (let index = 1; index < buckets.length; index++) {
    const bucket = buckets[index]
    if (onSameAmount(reference, bucket.amount)) {
      current.push(bucket)
      continue
    }

    const next = buckets[index + 1]
    const sustained = Boolean(next) && onSameAmount(bucket.amount, next.amount)
    if (!sustained) {
      // Montant atypique isolé : on le garde dans la série en cours.
      current.push(bucket)
      continue
    }

    if (current.length === 1) {
      current.push(bucket)
    } else {
      segments.push(current)
      current = [bucket]
    }
    reference = bucket.amount
  }

  segments.push(current)
  return segments
}

/**
 * Détecte les paiements et revenus récurrents.
 *
 * Regroupement par marchand ET par sens (un marchand peut être à la fois
 * créditeur et débiteur). Les occurrences d'une même journée sont fusionnées.
 *
 * Une série est découpée dès qu'une échéance est manquée ou que le montant
 * change durablement (deux occurrences consécutives). Un montant isolé, comme
 * une régularisation, ne casse pas la série. La partie suivante forme une
 * nouvelle série : un abonnement qui augmente ou reprend après une pause n'est
 * donc pas lissé sur des montants différents.
 */
export function detectRecurring(
  transactions: Transaction[],
  options: RecurringOptions = {},
): RecurringSeries[] {
  const reference = options.reference ?? referenceDate(transactions)
  const decisions = options.decisions ?? {}
  const aliases = options.aliases ?? {}

  const groups = new Map<string, Transaction[]>()
  for (const transaction of transactions) {
    if (transaction.amount === 0) continue
    const direction = transaction.amount > 0 ? 'in' : 'out'
    const key = `${transaction.merchantKey}|${direction}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(transaction)
    else groups.set(key, [transaction])
  }

  const results: RecurringSeries[] = []

  for (const [key, group] of groups) {
    const direction: 'expense' | 'income' = key.endsWith('|in')
      ? 'income'
      : 'expense'

    const byDate = new Map<string, DateBucket>()
    for (const transaction of group) {
      const amount = Math.abs(transaction.amount)
      const existing = byDate.get(transaction.date)
      if (!existing) {
        byDate.set(transaction.date, {
          date: transaction.date,
          amount,
          latest: transaction,
        })
        continue
      }
      existing.amount += amount
      if (transaction.order > existing.latest.order) existing.latest = transaction
    }

    const buckets = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    if (buckets.length < 2) continue

    const intervals = buckets
      .slice(1)
      .map((bucket, index) =>
        differenceInCalendarDays(
          parseISO(bucket.date),
          parseISO(buckets[index].date),
        ),
      )
      .filter((interval) => interval > 0)
    if (intervals.length === 0) continue

    const frequency = pickFrequency(intervals)
    if (!frequency) continue

    // Deux découpages successifs : une échéance manquée, puis un changement
    // durable de montant. Chaque tronçon obtenu est une série candidate.
    const segments = splitByCadence(buckets, frequency).flatMap(splitByAmount)
    const minimal = MIN_OCCURRENCES[frequency]
    const lastSegment = segments[segments.length - 1]
    // Une reprise récente après une pause ou un changement de montant peut
    // n'avoir que deux occurrences : on l'affiche si une série solide la précède.
    const previous = segments[segments.length - 2]
    const resumed =
      Boolean(lastSegment) &&
      Boolean(previous) &&
      previous!.length >= minimal &&
      lastSegment!.length >= 2
    const valid = segments.filter(
      (segment) => segment.length >= minimal || (segment === lastSegment && resumed),
    )
    if (valid.length === 0) continue

    valid.forEach((segment, segmentIndex) => {
      const dates = segment.map((bucket) => bucket.date)
      const amounts = segment.map((bucket) => bucket.amount)
      const segmentIntervals = dates
        .slice(1)
        .map((date, index) =>
          differenceInCalendarDays(parseISO(date), parseISO(dates[index])),
        )
        .filter((interval) => interval > 0)
      const medianInterval = median(segmentIntervals) || FREQUENCY_DAYS[frequency]

      const tolerance = CADENCE_TOLERANCE[frequency]
      // Régularité graduée : 1 quand l'échéance tombe pile, 0 à la limite de tolérance.
      let regularitySum = 0
      for (let index = 1; index < dates.length; index++) {
        const previousDate = dates[index - 1]
        const actual = differenceInCalendarDays(
          parseISO(dates[index]),
          parseISO(previousDate),
        )
        const expected = differenceInCalendarDays(
          expectedNext(previousDate, frequency),
          parseISO(previousDate),
        )
        regularitySum += 1 - Math.min(1, Math.abs(actual - expected) / tolerance)
      }
      const regularity =
        dates.length > 1 ? regularitySum / (dates.length - 1) : 1

      const medianAmount = median(amounts)
      if (medianAmount <= 0) return
      const deviations = amounts.map((amount) => Math.abs(amount - medianAmount))
      const stability = Math.max(0, 1 - median(deviations) / medianAmount)
      // Les vrais abonnements sont stables : une variation médiane de plus de
      // 10 % signale des achats variables, pas une récurrence.
      if (stability < 0.9) return

      const historyDepth = Math.min(1, segment.length / 10)
      // Une série courte reste possible mais ne doit pas afficher une confiance
      // élevée : le facteur d'échantillon pénalise les 2-3 premières occurrences.
      const sampleFactor = Math.min(1, (segment.length - 1) / 3)
      const confidence =
        Math.min(
          1,
          0.42 * regularity + 0.38 * stability + 0.2 * historyDepth,
        ) * sampleFactor

      const lastDate = dates[dates.length - 1]
      const lastAmount = amounts[amounts.length - 1]
      // Le montant médian ignore les régularisations ponctuelles : l'équivalent
      // mensuel reste représentatif du vrai abonnement.
      const averageAmount = medianAmount
      const monthlyAmount =
        averageAmount * (FREQUENCY_DAYS.monthly / medianInterval)
      const nextDate = format(
        nextBusinessDay(expectedNext(lastDate, frequency)),
        'yyyy-MM-dd',
      )
      const daysUntilNext = differenceInCalendarDays(
        parseISO(nextDate),
        parseISO(reference),
      )
      const daysSinceLast = differenceInCalendarDays(
        parseISO(reference),
        parseISO(lastDate),
      )
      // Une série remplacée par une plus récente est terminée, même si sa
      // dernière occurrence n'est pas très ancienne (changement de montant).
      const superseded = segmentIndex < valid.length - 1
      // Tant qu'une seule échéance a pu être manquée, la série reste active et
      // s'affiche « en retard ». Au-delà, elle est considérée comme terminée.
      const active =
        !superseded &&
        daysSinceLast <= medianInterval * 2 + CADENCE_TOLERANCE[frequency]
      const id = `${key}|${dates[0]}`
      const latest = segment[segment.length - 1].latest

      results.push({
        id,
        merchantKey: latest.merchantKey,
        label: resolveDisplayName(latest, aliases),
        categoryId: categoryIdOf(latest, aliases),
        direction,
        frequency,
        intervalDays: Math.round(medianInterval),
        occurrences: segment.length,
        dates,
        averageAmount,
        lastAmount,
        monthlyAmount,
        totalAmount: amounts.reduce((total, amount) => total + amount, 0),
        nextDate,
        daysUntilNext,
        overdue: daysUntilNext < 0,
        active,
        daysSinceLast,
        confidence,
        lastDate,
        decision: decisions[id] ?? 'pending',
      })
    })
  }

  return results.sort((a, b) => {
    return (
      Number(b.active) - Number(a.active) ||
      b.monthlyAmount - a.monthlyAmount
    )
  })
}

export interface RecurringSummary {
  expenseCount: number
  incomeCount: number
  monthlyExpenses: number
  monthlyIncome: number
  monthlyNet: number
  upcoming30: number
  upcomingAmount: number
  /** Séries actives en attente de validation (exclues des totaux). */
  pendingCount: number
  acceptedCount: number
  refusedCount: number
}

export function recurringSummary(series: RecurringSeries[]): RecurringSummary {
  let monthlyExpenses = 0
  let monthlyIncome = 0
  let expenseCount = 0
  let incomeCount = 0
  let upcoming30 = 0
  let upcomingAmount = 0
  let pendingCount = 0
  let acceptedCount = 0
  let refusedCount = 0

  for (const item of series) {
    if (item.decision === 'pending') {
      if (item.active) pendingCount++
      continue
    }
    if (item.decision === 'refused') {
      refusedCount++
      continue
    }
    acceptedCount++
    // Une série acceptée mais terminée ne pèse plus dans les totaux.
    if (!item.active) continue
    if (item.direction === 'expense') {
      monthlyExpenses += item.monthlyAmount
      expenseCount++
    } else {
      monthlyIncome += item.monthlyAmount
      incomeCount++
    }
    if (item.daysUntilNext >= 0 && item.daysUntilNext <= 30) {
      upcoming30++
      upcomingAmount += item.averageAmount
    }
  }

  return {
    expenseCount,
    incomeCount,
    monthlyExpenses,
    monthlyIncome,
    monthlyNet: monthlyIncome - monthlyExpenses,
    upcoming30,
    upcomingAmount,
    pendingCount,
    acceptedCount,
    refusedCount,
  }
}
