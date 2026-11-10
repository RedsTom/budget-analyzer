import { describe, expect, it } from 'vitest'
import {
  detectRecurring,
  recurringSummary,
  seriesInRange,
  type RecurringSeries,
  type RecurringStatus,
} from './recurring'
import type { Transaction } from './types'

let order = 0

function withDecision(
  series: RecurringSeries[],
  decision: RecurringStatus,
): RecurringSeries[] {
  return series.map((item) => ({ ...item, decision }))
}

function tx(
  date: string,
  amount: number,
  merchantKey = 'NETFLIX',
  rawLabel = 'PAIEMENT NETFLIX',
): Transaction {
  order++
  return {
    id: `${merchantKey}-${date}-${order}`,
    date,
    valueDate: date,
    debit: amount < 0 ? amount : null,
    credit: amount > 0 ? amount : null,
    amount,
    rawLabel,
    solde: 0,
    order,
    sourceFile: 'test.csv',
    merchantKey,
  }
}

describe('detectRecurring', () => {
  it('détecte un abonnement mensuel stable', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-04-05', -9.99),
      tx('2025-05-05', -9.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-05-20' })

    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      merchantKey: 'NETFLIX',
      direction: 'expense',
      frequency: 'monthly',
      occurrences: 5,
      averageAmount: 9.99,
      nextDate: '2025-06-05',
      daysUntilNext: 16,
      overdue: false,
    })
    expect(series[0].monthlyAmount).toBeCloseTo(9.99, 1)
    expect(series[0].confidence).toBeGreaterThan(0.8)
  })

  it('ignore un marchand fréquent aux montants erratiques', () => {
    const transactions = [
      tx('2025-01-03', -12),
      tx('2025-01-19', -54),
      tx('2025-02-07', -7),
      tx('2025-02-28', -112),
      tx('2025-03-12', -31),
      tx('2025-04-02', -3),
    ]

    expect(detectRecurring(transactions, { reference: '2025-04-10' })).toHaveLength(0)
  })

  it('détecte un revenu récurrent et le sépare des dépenses', () => {
    const transactions = [
      tx('2025-01-02', 1000, 'CAF', 'VIR CAF'),
      tx('2025-02-02', 1000, 'CAF', 'VIR CAF'),
      tx('2025-03-02', 1000, 'CAF', 'VIR CAF'),
      tx('2025-02-15', -20, 'CAF', 'FRAIS CAF'),
    ]

    const series = detectRecurring(transactions, { reference: '2025-03-10' })

    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      direction: 'income',
      frequency: 'monthly',
      averageAmount: 1000,
    })
  })

  it('détecte une dépense hebdomadaire', () => {
    const transactions = [
      tx('2025-01-06', -30, 'CROUS', 'CROUS'),
      tx('2025-01-13', -30, 'CROUS', 'CROUS'),
      tx('2025-01-20', -30, 'CROUS', 'CROUS'),
      tx('2025-01-27', -30, 'CROUS', 'CROUS'),
    ]

    const series = detectRecurring(transactions, { reference: '2025-02-01' })
    expect(series[0]).toMatchObject({ frequency: 'weekly', occurrences: 4 })
  })

  it('laisse les séries en attente de validation par défaut', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-04-05', -9.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-04-10' })

    expect(series[0].decision).toBe('pending')
    const summary = recurringSummary(series)
    expect(summary.pendingCount).toBe(1)
    expect(summary.expenseCount).toBe(0)
    expect(summary.monthlyExpenses).toBe(0)
  })

  it('applique les décisions et exclut refusées et en attente des totaux', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-04-05', -9.99),
    ]

    const series = detectRecurring(transactions, {
      reference: '2025-04-10',
      decisions: { 'NETFLIX|out|2025-01-05': 'accepted' },
    })

    expect(series[0].decision).toBe('accepted')
    const accepted = recurringSummary(series)
    expect(accepted.expenseCount).toBe(1)
    expect(accepted.acceptedCount).toBe(1)
    expect(accepted.monthlyExpenses).toBeCloseTo(series[0].monthlyAmount, 5)

    const refused = detectRecurring(transactions, {
      reference: '2025-04-10',
      decisions: { 'NETFLIX|out|2025-01-05': 'refused' },
    })
    const refusedSummary = recurringSummary(refused)
    expect(refused[0].decision).toBe('refused')
    expect(refusedSummary.refusedCount).toBe(1)
    expect(refusedSummary.expenseCount).toBe(0)
    expect(refusedSummary.monthlyExpenses).toBe(0)
  })

  it('signale une échéance dépassée', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-04-20' })
    expect(series[0].overdue).toBe(true)
    expect(series[0].active).toBe(true)
    expect(series[0].daysUntilNext).toBeLessThan(0)
  })

  it('marque comme terminée une série dont la dernière occurrence est ancienne', () => {
    const transactions = [
      tx('2023-01-05', -9.99),
      tx('2023-02-05', -9.99),
      tx('2023-03-05', -9.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-04-20' })
    expect(series[0].active).toBe(false)
    expect(recurringSummary(withDecision(series, 'accepted')).monthlyExpenses).toBe(0)
  })

  it('coupe la série quand le montant change', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-04-05', -12.99),
      tx('2025-05-05', -12.99),
      tx('2025-06-05', -12.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-06-10' })

    expect(series).toHaveLength(2)
    const [ancient, actuelle] = [...series].sort((a, b) =>
      a.dates[0].localeCompare(b.dates[0]),
    )
    expect(ancient).toMatchObject({ occurrences: 3, averageAmount: 9.99, active: false })
    expect(actuelle).toMatchObject({ occurrences: 3, averageAmount: 12.99, active: true })
    expect(
      recurringSummary(withDecision(series, 'accepted')).monthlyExpenses,
    ).toBeCloseTo(12.99, 1)
  })

  it('coupe la série quand une échéance est manquée', () => {
    const transactions = [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-06-05', -9.99),
      tx('2025-07-05', -9.99),
      tx('2025-08-05', -9.99),
    ]

    const series = detectRecurring(transactions, { reference: '2025-08-10' })
    const ordered = [...series].sort((a, b) => a.dates[0].localeCompare(b.dates[0]))

    expect(ordered).toHaveLength(2)
    expect(ordered[0]).toMatchObject({ occurrences: 3, active: false })
    expect(ordered[1]).toMatchObject({ occurrences: 3, active: true })
  })

  it('tolère les décalages de week-end et les mois de 28 à 31 jours', () => {
    const transactions = [
      tx('2025-01-31', -30),
      tx('2025-02-28', -30),
      tx('2025-03-31', -30),
      tx('2025-04-30', -30),
      tx('2025-08-01', -30),
      tx('2025-09-01', -30),
      tx('2025-10-01', -30),
      tx('2025-11-03', -30), // 1er novembre férié + week-end : reporté au lundi
      tx('2025-12-01', -30),
    ]

    const series = detectRecurring(transactions, { reference: '2025-12-15' })

    expect(series).toHaveLength(2)
    const dernier = series.find((item) => item.active)
    expect(dernier).toMatchObject({ occurrences: 5, frequency: 'monthly', nextDate: '2026-01-01' })
  })

  it('reporte la prochaine échéance au lundi quand elle tombe un week-end', () => {
    const transactions = [
      tx('2025-01-04', -30),
      tx('2025-02-04', -30),
      tx('2025-03-04', -30),
      tx('2025-04-04', -30),
    ]

    const series = detectRecurring(transactions, { reference: '2025-04-10' })
    // 4 mai 2025 est un dimanche : l'échéance est repoussée au lundi 5 mai.
    expect(series[0].nextDate).toBe('2025-05-05')
  })

  it('absorbe une régularisation ponctuelle sans casser la série', () => {
    const transactions = [
      tx('2026-01-06', -10.3),
      tx('2026-02-06', -6.98),
      tx('2026-03-06', -6.98),
      tx('2026-04-08', -6.98),
      tx('2026-05-06', -6.98),
      tx('2026-06-08', -6.98),
      tx('2026-07-07', -5.58),
    ]

    const series = detectRecurring(transactions, { reference: '2026-07-20' })

    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      occurrences: 7,
      averageAmount: 6.98,
      active: true,
    })
  })

  it('reprend une nouvelle série après une échéance manquée et un montant atypique', () => {
    // Cas réel « Assurance Habitation » : paiement sauté en août, puis
    // régularisation en septembre avant de retrouver le montant habituel.
    const transactions = [
      tx('2026-02-06', -6.98),
      tx('2026-03-06', -6.98),
      tx('2026-04-08', -6.98),
      tx('2026-05-06', -6.98),
      tx('2026-06-08', -6.98),
      tx('2026-07-07', -5.58),
      tx('2026-09-03', -10.3),
      tx('2026-10-05', -6.98),
      tx('2026-11-04', -6.98),
    ]

    const series = detectRecurring(transactions, { reference: '2026-11-10' })
    const ordered = [...series].sort((a, b) => a.dates[0].localeCompare(b.dates[0]))

    expect(ordered).toHaveLength(2)
    expect(ordered[0]).toMatchObject({ active: false, averageAmount: 6.98 })
    expect(ordered[1]).toMatchObject({
      active: true,
      occurrences: 3,
      averageAmount: 6.98,
      frequency: 'monthly',
    })
  })
})

describe('seriesInRange', () => {
  const series = detectRecurring(
    [
      tx('2025-01-05', -9.99),
      tx('2025-02-05', -9.99),
      tx('2025-03-05', -9.99),
      tx('2025-04-05', -9.99),
      tx('2025-05-05', -9.99),
    ],
    { reference: '2025-05-20' },
  )

  it('garde les séries avec une occurrence dans la période', () => {
    expect(
      seriesInRange(series, { start: '2025-01-01', end: '2025-02-28' }),
    ).toHaveLength(1)
  })

  it('garde les séries avec une échéance à venir dans la période', () => {
    expect(
      seriesInRange(series, { start: '2025-06-01', end: '2025-06-30' }),
    ).toHaveLength(1)
  })

  it('exclut les séries sans occurrence ni échéance', () => {
    expect(
      seriesInRange(series, { start: '2025-08-01', end: '2025-08-31' }),
    ).toHaveLength(0)
  })
})
