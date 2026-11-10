import { describe, expect, it } from 'vitest'
import {
  allocationCapacity,
  coverageAvailability,
  coverageSegments,
  detailedCoverageSegments,
  monthlyTotals,
  paymentAllocationStatuses,
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
  it('ne couvre plus automatiquement les paiements sans affectation', () => {
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
      coveredAmount: 0,
      remaining: 100,
      exhausted: false,
      coversUntil: null,
    })
    expect(segments[1]).toMatchObject({
      amount: 50,
      coveredAmount: 0,
      remaining: 50,
      exhausted: false,
      coversUntil: null,
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

  it('respecte les affectations personnalisées manuelles de couverture', () => {
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

  it('répartit un paiement sur plusieurs revenus', () => {
    const txs = [
      transaction('t1', '2026-01-01', 100, 100),
      transaction('t2', '2026-01-02', 100, 200),
      transaction('t3', '2026-01-03', -100, 100),
    ]
    const detailed = detailedCoverageSegments(txs, {
      t3: [
        { creditId: 't1', amount: 70 },
        { creditId: 't2', amount: 30 },
      ],
    })

    expect(detailed[0]).toMatchObject({ coveredAmount: 70, remaining: 30 })
    expect(detailed[1]).toMatchObject({ coveredAmount: 30, remaining: 70 })
    expect(detailed[0].expenses[0]).toMatchObject({
      transactionId: 't3',
      coveredAmount: 70,
      isCustom: true,
    })
    expect(detailed[1].expenses[0]).toMatchObject({
      transactionId: 't3',
      coveredAmount: 30,
      isCustom: true,
    })
  })

  it('laisse le reliquat non affecté quand la part est plafonnée', () => {
    const txs = [
      transaction('t1', '2026-01-01', 30, 30),
      transaction('t2', '2026-01-02', 100, 130),
      transaction('t3', '2026-01-03', -50, 80),
    ]
    const detailed = detailedCoverageSegments(txs, {
      t3: { creditId: 't1', amount: 30 },
    })

    expect(detailed[0].coveredAmount).toBe(30)
    expect(detailed[0].expenses[0]).toMatchObject({
      transactionId: 't3',
      coveredAmount: 30,
      isCustom: true,
    })
    expect(detailed[1].expenses).toHaveLength(0)
    expect(paymentAllocationStatuses(txs, { t3: { creditId: 't1', amount: 30 } })[0])
      .toMatchObject({ assignedAmount: 30, remainingAmount: 20, status: 'partial' })
  })
})

describe('affectations manuelles et ordre chronologique', () => {
  it('autorise un revenu postérieur pour résorber un découvert', () => {
    const txs = [
      transaction('e1', '2026-01-01', -50, 50),
      transaction('c1', '2026-01-10', 100, 150),
    ]
    const detailed = detailedCoverageSegments(txs, { e1: 'c1' })
    expect(detailed[0].coveredAmount).toBe(50)
    expect(detailed[0].expenses[0]).toMatchObject({
      transactionId: 'e1',
      coveredAmount: 50,
      isCustom: true,
    })
  })

  it('calcule la capacité d’un revenu postérieur', () => {
    const txs = [
      transaction('e1', '2026-01-01', -50, 50),
      transaction('c1', '2026-01-10', 100, 150),
    ]
    expect(allocationCapacity(txs, {}, 'e1', 'c1')).toMatchObject({
      available: 100,
      allocated: 50,
      blocked: false,
      full: true,
    })
  })

  it('accepte un revenu du même jour antérieur dans le grand livre', () => {
    const txs = [
      transaction('c1', '2026-01-01', 100, 100),
      transaction('e2', '2026-01-01', -40, 60),
    ]
    const detailed = detailedCoverageSegments(txs, { e2: 'c1' })
    expect(detailed[0].coveredAmount).toBe(40)
    expect(detailed[0].expenses[0].isCustom).toBe(true)
  })
})

describe('paymentAllocationStatuses', () => {
  it('classe les paiements sans affectation, partiels et traités', () => {
    const txs = [
      transaction('c1', '2026-01-01', 300, 300),
      transaction('e1', '2026-01-02', -100, 200),
      transaction('e2', '2026-01-03', -100, 100),
      transaction('e3', '2026-01-04', -100, 0),
    ]
    const statuses = paymentAllocationStatuses(txs, {
      e1: [{ creditId: 'c1', amount: 100 }],
      e2: [{ creditId: 'c1', amount: 40 }],
    })
    expect(statuses.map((status) => status.status)).toEqual([
      'done',
      'partial',
      'todo',
    ])
    expect(statuses[1]).toMatchObject({
      assignedAmount: 40,
      remainingAmount: 60,
      parts: [{ creditId: 'c1', amount: 40 }],
    })
  })
})

describe('coverageAvailability', () => {
  it('absorbe le découvert antérieur sur les crédits actifs les plus anciens', () => {
    // -497,62 de découvert avant le salaire de 600, puis 46,64 de dépenses.
    const txs = [
      transaction('e0', '2026-01-01', -497.62, -497.62),
      transaction('c1', '2026-01-08', 600, 102.38),
      transaction('e2', '2026-01-09', -46.64, 55.74),
      transaction('c2', '2026-01-10', 40, 95.74),
    ]
    const segments = detailedCoverageSegments(txs, { e2: 'c1' })
    const availability = coverageAvailability(segments, 95.74)

    expect(availability).toMatchObject({
      grossRemaining: 593.36,
      balance: 95.74,
      available: 95.74,
      absorbedDeficit: 497.62,
    })
    expect(availability.availableByCredit.c1).toBe(55.74)
    expect(availability.availableByCredit.c2).toBe(40)
    expect(availability.deficitByCredit.c1).toBe(497.62)
  })

  it('ne réduit rien quand le solde couvre tous les crédits', () => {
    const txs = [
      transaction('c1', '2026-01-01', 100, 100),
      transaction('e1', '2026-01-02', -20, 80),
    ]
    const availability = coverageAvailability(
      detailedCoverageSegments(txs, { e1: 'c1' }),
      200,
    )
    expect(availability.available).toBe(80)
    expect(availability.absorbedDeficit).toBe(0)
    expect(availability.availableByCredit.c1).toBe(80)
  })

  it('ramène les fonds actifs à zéro avec un solde négatif', () => {
    const txs = [
      transaction('e0', '2026-01-01', -200, -200),
      transaction('c1', '2026-01-02', 100, -100),
      transaction('e1', '2026-01-03', -20, -120),
    ]
    const availability = coverageAvailability(
      detailedCoverageSegments(txs, { e1: 'c1' }),
      -120,
    )
    expect(availability.available).toBe(0)
    expect(availability.absorbedDeficit).toBe(80)
    expect(availability.availableByCredit.c1).toBe(0)
  })
})

describe('allocationCapacity', () => {
  const txs = [
    transaction('c1', '2026-01-01', 100, 100),
    transaction('c2', '2026-01-02', 100, 200),
    transaction('e1', '2026-01-03', -40, 160),
    transaction('e2', '2026-01-04', -70, 90),
    transaction('e3', '2026-01-05', -20, 70),
  ]

  it('calcule la place après les autres affectations manuelles', () => {
    const capacity = allocationCapacity(
      txs,
      {
        e1: 'c1',
        e2: { creditId: 'c1', amount: 30 },
      },
      'e3',
      'c1',
    )
    expect(capacity).toMatchObject({
      otherManualDemand: 70,
      available: 30,
      allocated: 20,
      remainder: 0,
      full: true,
      blocked: false,
    })
  })

  it('signale un fractionnement possible', () => {
    const capacity = allocationCapacity(txs, { e1: 'c1' }, 'e2', 'c1')
    expect(capacity).toMatchObject({
      otherManualDemand: 40,
      available: 60,
      allocated: 60,
      remainder: 10,
      full: false,
      blocked: false,
    })
  })

  it('compte les parts multiples d’une autre dépense', () => {
    const capacity = allocationCapacity(
      [
        transaction('c1', '2026-01-01', 100, 100),
        transaction('c2', '2026-01-02', 100, 200),
        transaction('e1', '2026-01-03', -50, 150),
        transaction('e2', '2026-01-04', -40, 110),
      ],
      {
        e1: [
          { creditId: 'c1', amount: 30 },
          { creditId: 'c2', amount: 20 },
        ],
      },
      'e2',
      'c2',
    )
    expect(capacity).toMatchObject({
      otherManualDemand: 20,
      available: 80,
      blocked: false,
    })
  })

  it('bloque quand les autres manuelles ont tout réservé', () => {
    const capacity = allocationCapacity(
      txs,
      {
        e1: 'c1',
        e2: { creditId: 'c1', amount: 60 },
      },
      'e3',
      'c1',
    )
    expect(capacity).toMatchObject({
      available: 0,
      allocated: 0,
      remainder: 20,
      blocked: true,
    })
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
