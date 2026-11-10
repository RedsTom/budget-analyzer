import { describe, expect, it } from 'vitest'
import {
  datasetRange,
  periodLabel,
  previousPeriod,
  rangeDays,
  rangeMonths,
  resolvePeriod,
} from './period'
import type { Transaction } from './types'

function tx(date: string): Transaction {
  return {
    id: date,
    date,
    valueDate: date,
    debit: -1,
    credit: null,
    amount: -1,
    rawLabel: 'TEST',
    solde: 0,
    order: 0,
    sourceFile: 'test.csv',
    merchantKey: 'TEST',
  }
}

const transactions = [tx('2024-01-15'), tx('2026-10-05')]

describe('period', () => {
  it('déduit les bornes du jeu de données', () => {
    expect(datasetRange(transactions)).toEqual({
      start: '2024-01-15',
      end: '2026-10-05',
    })
  })

  it('ancre les presets sur la dernière date du jeu de données', () => {
    const range = resolvePeriod('30d', transactions)
    expect(range.end).toBe('2026-10-05')
    expect(range.start).toBe('2026-09-06')
  })

  it('aligne les presets mensuels sur le début de mois', () => {
    const range = resolvePeriod('6m', transactions)
    expect(range.start).toBe('2026-05-01')
  })

  it('respecte une période personnalisée et la borne au jeu de données', () => {
    const range = resolvePeriod('custom', transactions, {
      start: '2025-01-01',
      end: '2027-01-01',
    })
    expect(range).toEqual({ start: '2025-01-01', end: '2026-10-05' })
  })

  it('calcule une période précédente de même durée', () => {
    const previous = previousPeriod({ start: '2025-03-01', end: '2025-03-31' })
    expect(previous).toEqual({ start: '2025-01-29', end: '2025-02-28' })
  })

  it('liste les mois et les jours d’une période', () => {
    expect(rangeMonths({ start: '2025-01-15', end: '2025-03-02' })).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ])
    expect(rangeDays({ start: '2025-01-01', end: '2025-01-31' })).toBe(31)
  })

  it('formate un libellé lisible', () => {
    expect(periodLabel({ start: '2025-01-01', end: '2025-01-31' }, 'custom')).toContain(
      '→',
    )
    expect(periodLabel({ start: '2024-01-15', end: '2026-10-05' }, 'all')).toBe(
      'Tout l’historique',
    )
  })
})
