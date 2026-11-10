import { describe, expect, it } from 'vitest'
import {
  categoryBreakdown,
  highlights,
  merchantStats,
  monthlySeries,
  percentChange,
  summarize,
  totalsForRange,
  weekdayBreakdown,
} from './analytics'
import { autoCategoryId } from './categories'
import type { Transaction } from './types'

let order = 0

function tx(
  date: string,
  amount: number,
  merchantKey: string,
  rawLabel = merchantKey,
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

const sample: Transaction[] = [
  tx('2025-01-05', 2000, 'DRFIP', 'VIR SALAIRE DRFIP'),
  tx('2025-01-08', -42.5, 'LIDL', 'PAIEMENT LIDL'),
  tx('2025-01-09', -12, 'NETFLIX', 'PAIEMENT NETFLIX'),
  tx('2025-02-05', 2000, 'DRFIP', 'VIR SALAIRE DRFIP'),
  tx('2025-02-08', -50, 'LIDL', 'PAIEMENT LIDL'),
  tx('2025-03-08', -60, 'LIDL', 'PAIEMENT LIDL'),
]

const range = { start: '2025-01-01', end: '2025-03-31' }

describe('analytics', () => {
  it('résume entrées, sorties et taux d’épargne', () => {
    const totals = summarize(sample)
    expect(totals.income).toBe(4000)
    expect(totals.expenses).toBe(164.5)
    expect(totals.net).toBe(3835.5)
    expect(totals.incomeCount).toBe(2)
    expect(totals.expenseCount).toBe(4)
    expect(totals.savingsRate).toBeCloseTo(0.9588, 3)
  })

  it('filtre par période', () => {
    const totals = totalsForRange(sample, { start: '2025-01-01', end: '2025-01-31' })
    expect(totals.income).toBe(2000)
    expect(totals.expenses).toBe(54.5)
  })

  it('produit une série mensuelle continue, mois vides inclus', () => {
    const points = monthlySeries(sample, { start: '2024-12-01', end: '2025-03-31' })
    expect(points.map((point) => point.month)).toEqual([
      '2024-12',
      '2025-01',
      '2025-02',
      '2025-03',
    ])
    expect(points[0].count).toBe(0)
    expect(points[1]).toMatchObject({ income: 2000, expenses: 54.5, net: 1945.5 })
    expect(points[2]).toMatchObject({ income: 2000, expenses: 50 })
  })

  it('calcule les variations en pourcentage', () => {
    expect(percentChange(110, 100)).toBeCloseTo(0.1)
    expect(percentChange(90, 100)).toBeCloseTo(-0.1)
    expect(percentChange(10, 0)).toBeNull()
    expect(percentChange(0, 0)).toBe(0)
    expect(percentChange(500, -0.5)).toBeNull()
  })

  it('agrège les marchands', () => {
    const stats = merchantStats(sample, range, {})
    const lidl = stats.find((stat) => stat.merchantKey === 'LIDL')!
    expect(lidl).toMatchObject({ count: 3, expenses: 152.5, income: 0 })
    expect(lidl.averageExpense).toBeCloseTo(50.833, 2)
    expect(stats[0].merchantKey).toBe('DRFIP')
  })

  it('ventile les dépenses par catégorie', () => {
    const slices = categoryBreakdown(sample, range, {}, 'expense')
    const names = slices.map((slice) => slice.name)
    expect(names).toContain('Alimentation')
    expect(names).toContain('Abonnements')
    const total = slices.reduce((sum, slice) => sum + slice.share, 0)
    expect(total).toBeCloseTo(1)
  })

  it('ventile les dépenses par jour de semaine', () => {
    const days = weekdayBreakdown(sample, range)
    expect(days).toHaveLength(7)
    expect(days.reduce((sum, day) => sum + day.total, 0)).toBeCloseTo(164.5)
    expect(days[2].total).toBeCloseTo(42.5, 2)
    expect(days[5].total).toBeCloseTo(110, 2)
  })

  it('expose des faits saillants', () => {
    const items = highlights(sample, range, {})
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['biggest-expense', 'biggest-income', 'savings-rate']),
    )
  })

  it('classe les marchands connus', () => {
    expect(autoCategoryId({ merchantKey: 'LIDL', rawLabel: 'PAIEMENT LIDL', amount: -10 })).toBe(
      'alimentation',
    )
    expect(autoCategoryId({ merchantKey: 'NETFLIX', rawLabel: 'PAIEMENT NETFLIX', amount: -10 })).toBe(
      'abonnements',
    )
    expect(autoCategoryId({ merchantKey: 'DRFIP', rawLabel: 'VIR SALAIRE', amount: 2000 })).toBe(
      'revenus',
    )
  })
})
