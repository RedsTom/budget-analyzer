import type { ParsedTransaction } from './csv'
import type { Transaction } from './types'

/**
 * Empreinte de la ligne bancaire brute. Le solde fait partie de l'identité :
 * deux achats identiques le même jour ont des soldes courants différents, alors
 * qu'une vraie ligne dupliquée a exactement le même solde.
 */
export function fingerprint(
  transaction: Pick<
    ParsedTransaction,
    'date' | 'valueDate' | 'debit' | 'credit' | 'rawLabel' | 'solde'
  >,
): string {
  const amount = (value: number | null) =>
    value === null ? '' : value.toFixed(2)

  return [
    transaction.date,
    transaction.valueDate,
    amount(transaction.debit),
    amount(transaction.credit),
    transaction.rawLabel,
    amount(transaction.solde),
  ].join('|')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function compareLedger(a: Transaction, b: Transaction): number {
  return a.date.localeCompare(b.date) || a.order - b.order
}

export interface MergeResult {
  transactions: Transaction[]
  added: number
  duplicates: number
}

/** `id` = `<hash de contenu>:<occurrence dans le fichier>`. */
export function contentHashOf(transaction: { id: string }): string {
  return transaction.id.split(':')[0]
}

/**
 * Fusionne un import dans l'existant, en multiensemble.
 *
 * Deux lignes d'un même export peuvent être identiques champ pour champ et
 * être pourtant deux opérations réelles (vérifié sur un relevé : deux lignes
 * identiques au même montant et même solde sont nécessaires à la continuité
 * du solde). On ne supprime donc que la *sur-occurrence* : une
 * même ligne déjà présente autant de fois qu'elle l'est dans l'existant.
 *
 * Idempotent : réimporter un fichier, ou un export qui chevauche le précédent,
 * n'ajoute rien.
 */
export async function mergeTransactions(
  existing: Transaction[],
  incoming: ParsedTransaction[],
  sourceFile: string,
): Promise<MergeResult> {
  const existingOccurrences = new Map<string, number>()
  for (const transaction of existing) {
    const contentHash = contentHashOf(transaction)
    existingOccurrences.set(
      contentHash,
      (existingOccurrences.get(contentHash) ?? 0) + 1,
    )
  }

  let order = existing.reduce(
    (maximum, transaction) => Math.max(maximum, transaction.order),
    -1,
  )
  const incomingOccurrences = new Map<string, number>()
  const added: Transaction[] = []
  let duplicates = 0

  for (const row of incoming) {
    const contentHash = await sha256Hex(fingerprint(row))
    const occurrence = (incomingOccurrences.get(contentHash) ?? 0) + 1
    incomingOccurrences.set(contentHash, occurrence)

    if (occurrence <= (existingOccurrences.get(contentHash) ?? 0)) {
      duplicates++
      continue
    }

    added.push({
      ...row,
      id: `${contentHash}:${occurrence - 1}`,
      order: ++order,
      sourceFile,
    })
  }

  const transactions = [...existing, ...added].sort(compareLedger)
  return { transactions, added: added.length, duplicates }
}
