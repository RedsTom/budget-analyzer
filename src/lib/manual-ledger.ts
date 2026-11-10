import { compareLedger } from './dedupe'
import type { Transaction } from './types'

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function clone(transactions: Transaction[]): Transaction[] {
  return transactions.map((transaction) => ({ ...transaction }))
}

/**
 * Supprime une opération et propage le décalage inverse aux soldes suivants.
 * Fonction pure : les objets d'entrée ne sont jamais mutés.
 */
export function removeFromLedger(
  transactions: Transaction[],
  id: string,
): Transaction[] {
  const updated = clone(transactions)
  const index = updated.findIndex((transaction) => transaction.id === id)
  if (index < 0) return updated

  const removedAmount = updated[index].amount
  updated.splice(index, 1)
  for (let i = index; i < updated.length; i += 1) {
    updated[i].solde = round(updated[i].solde - removedAmount)
  }
  reindex(updated)
  return updated
}

/**
 * Insère une opération, calcule son solde à partir de la précédente et
 * propage le montant aux soldes suivants.
 */
export function insertIntoLedger(
  transactions: Transaction[],
  transaction: Transaction,
): Transaction[] {
  const updated = clone(transactions)
  const inserted: Transaction = { ...transaction, solde: 0 }
  updated.push(inserted)
  updated.sort(compareLedger)

  const index = updated.findIndex((item) => item.id === inserted.id)
  if (index < 0) return updated

  if (index === 0) {
    inserted.solde =
      updated.length > 1
        ? round(updated[1].solde - updated[1].amount + inserted.amount)
        : inserted.amount
  } else {
    inserted.solde = round(updated[index - 1].solde + inserted.amount)
  }

  for (let i = index + 1; i < updated.length; i += 1) {
    updated[i].solde = round(updated[i].solde + inserted.amount)
  }
  reindex(updated)
  return updated
}

/**
 * Remplace une opération existante en une seule passe logique : suppression
 * puis réinsertion, sans écriture intermédiaire dans le coffre.
 */
export function updateInLedger(
  transactions: Transaction[],
  transaction: Transaction,
): Transaction[] {
  return insertIntoLedger(removeFromLedger(transactions, transaction.id), transaction)
}

function reindex(transactions: Transaction[]): void {
  for (let i = 0; i < transactions.length; i += 1) {
    transactions[i].order = i + 1
  }
}
