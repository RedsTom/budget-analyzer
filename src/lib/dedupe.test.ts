import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCsvText } from './csv'
import { mergeTransactions } from './dedupe'
import { balanceChainBreaks } from './runway'

// Les relevés de référence sont des données personnelles : ils ne sont pas
// versionnés. Copiez-les dans fixtures/ pour lancer les tests d'intégration.
const completePath = new URL('../../fixtures/releve-complet.csv', import.meta.url)
const partialPath = new URL('../../fixtures/releve-partiel.csv', import.meta.url)
const hasFixtures = existsSync(completePath) && existsSync(partialPath)
const readFixture = (path: URL) =>
  existsSync(path) ? readFileSync(path).toString('latin1') : ''

const completeRows = hasFixtures ? parseCsvText(readFixture(completePath)).rows : []
const partialRows = hasFixtures ? parseCsvText(readFixture(partialPath)).rows : []

describe.skipIf(!hasFixtures)('mergeTransactions', () => {
  it('garde les lignes identiques d’un même export (multiensemble)', async () => {
    const first = await mergeTransactions([], completeRows, '00021876101(1).csv')
    // Les deux lignes identiques du 30/07/2024 sont deux opérations réelles :
    // les supprimer casse la chaîne des soldes.
    expect(first.added).toBe(1728)
    expect(first.duplicates).toBe(0)

    const second = await mergeTransactions(
      first.transactions,
      partialRows,
      '00021876101.csv',
    )
    expect(second.added).toBe(0)
    expect(second.duplicates).toBe(198)
    expect(second.transactions).toHaveLength(1728)
  })

  it('reste idempotent dans l’ordre inverse (court puis complet)', async () => {
    const first = await mergeTransactions([], partialRows, '00021876101.csv')
    expect(first.added).toBe(198)

    const second = await mergeTransactions(
      first.transactions,
      completeRows,
      '00021876101(1).csv',
    )
    expect(second.duplicates).toBe(198)
    expect(second.added).toBe(1530)
    expect(second.transactions).toHaveLength(1728)
    expect(balanceChainBreaks(second.transactions)).toEqual([])
  })

  it('ignore un réimport à l’identique', async () => {
    const first = await mergeTransactions([], completeRows, '00021876101(1).csv')
    const again = await mergeTransactions(
      first.transactions,
      completeRows,
      '00021876101(1).csv',
    )
    expect(again.added).toBe(0)
    expect(again.duplicates).toBe(1728)
    expect(again.transactions).toHaveLength(1728)
  })

  it('produit des identifiants uniques et un ordre chronologique stable', async () => {
    const { transactions } = await mergeTransactions(
      [],
      completeRows,
      '00021876101(1).csv',
    )

    expect(new Set(transactions.map((transaction) => transaction.id)).size).toBe(
      transactions.length,
    )
    const dates = transactions.map((transaction) => transaction.date)
    expect(dates).toEqual([...dates].sort())
    expect(balanceChainBreaks(transactions)).toEqual([])
  })

  it('conserve les achats identiques le même jour (soldes distincts)', async () => {
    const { transactions } = await mergeTransactions(
      [],
      completeRows,
      '00021876101(1).csv',
    )

    const groups = new Map<string, Set<number>>()
    for (const transaction of transactions) {
      const key = `${transaction.date}|${transaction.amount}|${transaction.rawLabel}`
      groups.set(key, (groups.get(key) ?? new Set()).add(transaction.solde))
    }
    const repeated = [...groups.values()].filter((soldes) => soldes.size > 1)
    expect(repeated).toHaveLength(17)
  })
})
