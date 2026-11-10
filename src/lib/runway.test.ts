import { describe, expect, it } from 'vitest'
import {
  coverageSegments,
  monthlyTotals,
  runwayProjection,
} from './runway'
import type { Transaction } from './types'

function transaction(
  id: string,
  date: string,
  amount: number,
  solde: number,
): Transaction {
  return {
    id,
    date,
    valueDate: date,
    debit: amount < 0 ? amount : null,
    credit: amount > 0 ? amount : null,
    amount,
    rawLabel: id,
    solde,
    order: Number(id.replace(/\D/g, '')),
    sourceFile: 'test.csv',
    merchantKey: id,
  }
}

describe('coverageSegments', () => {
  it('consomme les crédits en FIFO et donne la date de fin de couverture', () => {
    const segments = coverageSegments([
      transaction('t1', '2026-01-01', 100, 100),
      transaction('t2', '2026-01-02', -40, 60),
      transaction('t3', '2026-01-03', -70, -10),
      transaction('t4', '2026-01-04', 50, 40),
      transaction('t5', '2026-01-05', -10, 30),
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      amount: 100,
      coveredAmount: 100,
      remaining: 0,
      exhausted: true,
      coversUntil: '2026-01-03',
    })
    expect(segments[1]).toMatchObject({
      amount: 50,
      coveredAmount: 10,
      remaining: 40,
      exhausted: false,
      coversUntil: '2026-01-05',
    })
  })

  it('ignore une dépense non couverte', () => {
    const segments = coverageSegments([
      transaction('t1', '2026-01-01', -20, -20),
      transaction('t2', '2026-01-02', 10, -10),
    ])
    expect(segments[0].coveredAmount).toBe(0)
    expect(segments[0].coversUntil).toBeNull()
  })

  it('respecte les affectations personnalisées manuelles de couverture', async () => {
    const { detailedCoverageSegments } = await import('./runway')
    // t1 (crédit 100), t2 (crédit 100), t3 (dépense -50 affectée manuellement à t2)
    const txs = [
      transaction('t1', '2026-01-01', 100, 100),
      transaction('t2', '2026-01-02', 100, 200),
      transaction('t3', '2026-01-03', -50, 150),
    ]
    const detailed = detailedCoverageSegments(txs, { t3: 't2' })
    // t1 n'a pas été consommé par t3
    expect(detailed[0].remaining).toBe(100)
    expect(detailed[0].coveredAmount).toBe(0)
    // t2 a couvert t3
    expect(detailed[1].remaining).toBe(50)
    expect(detailed[1].coveredAmount).toBe(50)
    expect(detailed[1].expenses[0].isCustom).toBe(true)
  })
})

describe('runwayProjection', () => {
  it('estime la date d’épuisement à partir de la dépense moyenne', () => {
    const projection = runwayProjection(
      [
        transaction('t1', '2026-10-01', -400, 500),
        transaction('t2', '2026-10-02', -500, 0),
        transaction('t3', '2026-11-01', 100, 100),
      ],
      { now: new Date('2026-11-08T00:00:00Z'), lookbackDays: 90 },
    )

    expect(projection.balance).toBe(100)
    expect(projection.averageDailyExpense).toBeCloseTo(10)
    expect(projection.daysLeft).toBeCloseTo(10)
    expect(projection.endsOn).toBe('2026-11-18')
  })

  it('retourne null sans dépense', () => {
    const projection = runwayProjection([transaction('t1', '2026-01-01', 50, 50)])
    expect(projection.daysLeft).toBeNull()
    expect(projection.endsOn).toBeNull()
  })
})

describe('monthlyTotals', () => {
  it('agrège dépenses et revenus par mois', () => {
    const totals = monthlyTotals([
      transaction('t1', '2026-01-01', 100, 100),
      transaction('t2', '2026-01-02', -40, 60),
      transaction('t3', '2026-02-01', -10, 50),
    ])

    expect(totals).toEqual([
      { month: '2026-01', expenses: 40, income: 100, net: 60 },
      { month: '2026-02', expenses: 10, income: 0, net: -10 },
    ])
  })
})
