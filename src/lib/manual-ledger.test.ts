import { describe, expect, it } from 'vitest'
import {
  insertIntoLedger,
  removeFromLedger,
  updateInLedger,
} from './manual-ledger'
import type { Transaction } from './types'

function tx(
  id: string,
  date: string,
  amount: number,
  solde: number,
  order: number,
): Transaction {
  return {
    id,
    date,
    valueDate: date,
    debit: amount < 0 ? amount : null,
    credit: amount > 0 ? amount : null,
    amount,
    rawLabel: id,
    merchantKey: id,
    order,
    sourceFile: 'manual',
    isManual: true,
    solde,
  }
}

const base: Transaction[] = [
  tx('a', '2024-01-01', 100, 100, 1),
  tx('b', '2024-01-02', -20, 80, 2),
  tx('c', '2024-01-03', -10, 70, 3),
]

function balances(rows: Transaction[]): number[] {
  return rows.map((row) => row.solde)
}

describe('manual-ledger', () => {
  it('insère au milieu et propage le décalage', () => {
    const next = insertIntoLedger(
      base,
      tx('new', '2024-01-02', -5, 0, 0),
    )
    expect(next.map((row) => row.id)).toEqual(['a', 'new', 'b', 'c'])
    expect(balances(next)).toEqual([100, 95, 75, 65])
    expect(next.map((row) => row.order)).toEqual([1, 2, 3, 4])
  })

  it('insère en tête en recalculant le solde d’ouverture', () => {
    const next = insertIntoLedger(
      base,
      tx('new', '2023-12-31', 50, 0, 0),
    )
    expect(next.map((row) => row.id)).toEqual(['new', 'a', 'b', 'c'])
    expect(balances(next)).toEqual([50, 150, 130, 120])
  })

  it('insère en fin sans toucher aux soldes précédents', () => {
    const next = insertIntoLedger(
      base,
      tx('new', '2024-01-04', -7, 0, 0),
    )
    expect(balances(next)).toEqual([100, 80, 70, 63])
  })

  it('supprime et propage le décalage inverse', () => {
    const next = removeFromLedger(base, 'b')
    expect(next.map((row) => row.id)).toEqual(['a', 'c'])
    expect(balances(next)).toEqual([100, 90])
    expect(next.map((row) => row.order)).toEqual([1, 2])
  })

  it('met à jour une opération en une seule passe logique', () => {
    const changed = tx('b', '2024-01-02', -30, 0, 0)
    const next = updateInLedger(base, changed)
    expect(next.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(balances(next)).toEqual([100, 70, 60])
    expect(next.find((row) => row.id === 'b')?.amount).toBe(-30)
  })

  it('conserve l’identifiant lors d’un changement de date', () => {
    const moved = tx('b', '2024-01-04', -20, 0, 0)
    const next = updateInLedger(base, moved)
    expect(next.map((row) => row.id)).toEqual(['a', 'c', 'b'])
    expect(balances(next)).toEqual([100, 90, 70])
  })

  it('ne mute pas les objets d’entrée', () => {
    const snapshot = JSON.stringify(base)
    insertIntoLedger(base, tx('new', '2024-01-02', -5, 0, 0))
    removeFromLedger(base, 'b')
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})
