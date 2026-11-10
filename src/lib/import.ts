import { decodeCsvBytes, parseCsvText, type ParseCsvOptions } from './csv'
import { mergeTransactions } from './dedupe'
import type { ImportSummary, Transaction } from './types'

export interface ImportResult {
  transactions: Transaction[]
  summary: ImportSummary
}

/**
 * Pipeline d'import : décodage (UTF-8 puis Windows-1252) → parse → dédoublonnage.
 * Le mappage des colonnes est optionnel : sans lui, les en-têtes sont devinés.
 * Le nom du fichier n'entre pas dans la clé : deux exports du même compte
 * peuvent se chevaucher sans double comptage.
 */
export async function importCsvBytes(
  existing: Transaction[],
  input: ArrayBuffer | Uint8Array,
  sourceFile: string,
  options: ParseCsvOptions = {},
): Promise<ImportResult> {
  const text = decodeCsvBytes(input)
  const { rows, errors } = parseCsvText(text, options)
  const merged = await mergeTransactions(existing, rows, sourceFile)

  return {
    transactions: merged.transactions,
    summary: {
      added: merged.added,
      duplicates: merged.duplicates,
      errors,
      sourceFile,
    },
  }
}
