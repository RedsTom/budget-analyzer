import Papa from 'papaparse'
import { buildMerchantKey } from './labels'
import type { ParseError, Transaction } from './types'

export type ParsedTransaction = Omit<Transaction, 'id' | 'order' | 'sourceFile'>

export interface CsvParseResult {
  rows: ParsedTransaction[]
  errors: ParseError[]
}

/** Fichier lu et parsé, prêt à être fusionné dans le coffre. */
export interface ParsedCsvFile {
  rows: ParsedTransaction[]
  errors: ParseError[]
  sourceFile: string
}

/** Champs que l'application sait exploiter dans un relevé. */
export const CSV_FIELDS = [
  'date',
  'valueDate',
  'debit',
  'credit',
  'amount',
  'label',
  'solde',
] as const

export type CsvField = (typeof CSV_FIELDS)[number]

/** Index (0-based) de la colonne associée à chaque champ. */
export type ColumnMapping = Partial<Record<CsvField, number>>

export type DecimalSeparator = 'auto' | ',' | '.'

/** Certaines banques exportent les débits en positif : on peut inverser le signe. */
export type DebitSign = 'negative' | 'positive'

export interface ParseCsvOptions {
  mapping?: ColumnMapping
  delimiter?: string
  /** La première ligne utile contient-elle les en-têtes ? */
  hasHeader?: boolean
  decimalSeparator?: DecimalSeparator
  debitSign?: DebitSign
}

export interface CsvInspection {
  delimiter: string
  /** Numéro de ligne (1-based) de la ligne d'en-tête détectée. */
  headerLine: number
  headers: string[]
  /** Correspondance devinée à partir des en-têtes. */
  mapping: ColumnMapping
  /** Vrai si la correspondance devinée suffit à importer sans intervention. */
  complete: boolean
  /** Quelques lignes de données brutes, pour l'aperçu. */
  sampleRows: string[][]
  totalRows: number
}

export const FIELD_LABELS: Record<CsvField, string> = {
  date: 'Date d’opération',
  valueDate: 'Date de valeur',
  debit: 'Débit',
  credit: 'Crédit',
  amount: 'Montant signé',
  label: 'Libellé',
  solde: 'Solde',
}

const COLUMN_ALIASES: Record<CsvField, readonly string[]> = {
  date: [
    'date',
    'date operation',
    'date op',
    'date comptable',
    'date transaction',
    'booking date',
    'transaction date',
  ],
  valueDate: [
    'date de valeur',
    'date valeur',
    'value date',
    'valeur',
    'date value',
  ],
  debit: [
    'debit',
    'debit eur',
    'montant debit',
    'debit euros',
    'debit (eur)',
    'withdrawal',
    'money out',
  ],
  credit: [
    'credit',
    'credit eur',
    'montant credit',
    'credit euros',
    'credit (eur)',
    'deposit',
    'money in',
  ],
  amount: [
    'montant',
    'montant signe',
    'montant eur',
    'amount',
    'somme',
    'transaction amount',
  ],
  label: [
    'libelle',
    'libelle operation',
    'libelle simplifie',
    'description',
    'label',
    'intitule',
    'memo',
    'details',
    'narrative',
  ],
  solde: [
    'solde',
    'solde eur',
    'solde apres operation',
    'solde apres',
    'balance',
    'running balance',
    'solde euros',
  ],
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Décode les octets de l'export. On tente d'abord l'UTF-8 strict (formats
 * récents) puis on retombe sur le Windows-1252 produit par la banque :
 * `0xE9` doit devenir `é`, sinon `Débit` s'affiche `D�bit`.
 */
export function decodeCsvBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function resolveSeparator(value: string, separator: DecimalSeparator): ',' | '.' | null {
  if (separator !== 'auto') return separator

  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')

  if (lastComma === -1 && lastDot === -1) return null
  if (lastComma !== -1 && lastDot !== -1) {
    return lastComma > lastDot ? ',' : '.'
  }

  // Un séparateur unique : la virgule est décimale en français. Un point est
  // décimal sauf s'il ressemble à un séparateur de milliers (`1.234`).
  if (lastComma !== -1) return ','

  const occurrences = value.split('.').length - 1
  const decimals = value.length - lastDot - 1
  const integerDigits = value.slice(0, lastDot).replace(/[^0-9]/g, '').length
  if (occurrences > 1) return decimals === 3 ? null : '.'
  if (decimals === 3 && integerDigits > 0 && integerDigits <= 3) return null
  return '.'
}

/**
 * Montants variés : « 1 500,00 », « -6,99 », « $1,234.56 », « (12,50) »,
 * « 40,00- ». Le signe est conservé ; les symboles monétaires sont ignorés.
 */
export function parseAmount(
  raw: string,
  decimalSeparator: DecimalSeparator = 'auto',
): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const parenthesized = /^\(.*\)$/.test(trimmed)
  const trailingMinus = /-\s*$/.test(trimmed)

  let value = trimmed
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/\u2212/g, '-')
    .replace(/[^\d.,+-]/g, '')

  if (!/[\d]/.test(value)) return null

  const negative = value.startsWith('-') || parenthesized || trailingMinus
  value = value.replace(/[+-]/g, '')
  if (!value) return null

  const separator = resolveSeparator(value, decimalSeparator)
  let normalized: string

  if (separator) {
    const parts = value.split(separator)
    const decimals = (parts.pop() ?? '').replace(/[.,]/g, '')
    const integerPart = parts.join('').replace(/[.,]/g, '')
    normalized = `${integerPart}.${decimals}`
  } else {
    normalized = value.replace(/[.,]/g, '')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return negative ? -Math.abs(parsed) : parsed
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** `jj/mm/aaaa` strict → `yyyy-mm-dd`, avec validation des composantes. */
export function parseFrenchDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (!match) return null
  return buildIsoDate(Number(match[3]), Number(match[2]), Number(match[1]))
}

/**
 * Dates de relevés : `jj/mm/aaaa`, `jj-mm-aaaa`, `jj.mm.aaaa`, `aaaa-mm-jj`
 * et variantes ISO avec heure. Les années sur 2 chiffres sont acceptées.
 */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value)
  if (iso) return buildIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const french = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value)
  if (french) {
    let year = Number(french[3])
    if (year < 100) year += year <= 68 ? 2000 : 1900
    return buildIsoDate(year, Number(french[2]), Number(french[1]))
  }

  return null
}

function detectMapping(header: string[]): ColumnMapping {
  const normalized = header.map(normalizeHeader)
  const used = new Set<number>()
  const mapping: ColumnMapping = {}

  for (const field of CSV_FIELDS) {
    const aliases = COLUMN_ALIASES[field]
    const index = normalized.findIndex(
      (value, position) => !used.has(position) && aliases.includes(value),
    )
    if (index !== -1) {
      mapping[field] = index
      used.add(index)
    }
  }

  return mapping
}

/** Message bloquant si la correspondance ne permet pas un import fiable. */
export function mappingIssue(mapping: ColumnMapping): string | null {
  if (mapping.date == null) return 'Associez la colonne des dates d’opération.'
  if (mapping.label == null) return 'Associez la colonne des libellés.'

  const hasSignedAmount = mapping.amount != null
  const hasSplitAmounts = mapping.debit != null && mapping.credit != null
  if (!hasSignedAmount && !hasSplitAmounts) {
    return 'Associez un montant signé, ou les deux colonnes Débit et Crédit.'
  }

  return null
}

function parseRawCsv(text: string, delimiter?: string) {
  return Papa.parse<string[]>(text, {
    delimiter: delimiter || undefined,
    skipEmptyLines: 'greedy',
  })
}

function locateHeader(data: string[][]): {
  headerLine: number
  headers: string[]
  mapping: ColumnMapping
} {
  const limit = Math.min(data.length, 30)
  for (let index = 0; index < limit; index++) {
    const row = data[index] ?? []
    const mapping = detectMapping(row)
    const matches = Object.keys(mapping).length
    if (matches >= 2 && (mapping.date != null || mapping.label != null)) {
      return { headerLine: index + 1, headers: row, mapping }
    }
  }

  const first = data.findIndex((row) => row.some((cell) => cell.trim()))
  const index = first === -1 ? 0 : first
  const row = data[index] ?? []
  return { headerLine: index + 1, headers: row, mapping: detectMapping(row) }
}

/**
 * Analyse un export sans l'importer : délimiteur, en-têtes, correspondance
 * devinée et aperçu. Sert à décider s'il faut demander un mappage manuel.
 */
export function inspectCsvText(text: string, delimiter?: string): CsvInspection {
  const parsed = parseRawCsv(text, delimiter)
  const data = parsed.data
  const { headerLine, headers, mapping } = locateHeader(data)

  return {
    delimiter: parsed.meta.delimiter || ';',
    headerLine,
    headers,
    mapping,
    complete: mappingIssue(mapping) === null,
    sampleRows: data.slice(headerLine, headerLine + 5),
    totalRows: Math.max(0, data.length - headerLine),
  }
}

/**
 * Parse un export déjà décodé. Ne dédoublonne pas et n'assigne ni `id` ni `order`.
 * `Débit` est supposé déjà négatif pour le format bancaire historique : le
 * signe n'est inversé que si l'utilisateur le demande (`debitSign: 'positive'`).
 * Sans colonne de solde, un solde courant continu est reconstruit depuis 0.
 */
export function parseCsvText(text: string, options: ParseCsvOptions = {}): CsvParseResult {
  const parsed = parseRawCsv(text, options.delimiter)

  const errors: ParseError[] = parsed.errors.map((error) => ({
    line: (error.row ?? 0) + 1,
    message: error.message,
  }))

  const data = parsed.data
  const located = locateHeader(data)
  const mapping = options.mapping ?? located.mapping
  const issue = mappingIssue(mapping)

  if (issue) {
    return {
      rows: [],
      errors: [...errors, { line: located.headerLine, message: issue }],
    }
  }

  const hasHeader = options.hasHeader ?? true
  const start = hasHeader ? located.headerLine : located.headerLine - 1
  const rows: ParsedTransaction[] = []
  let runningBalance = 0

  for (let index = start; index < data.length; index++) {
    const cells = data[index]
    if (!cells || cells.every((cell) => !cell.trim())) continue

    const line = index + 1
    const rawDate = cells[mapping.date!] ?? ''
    const date = parseFlexibleDate(rawDate)
    if (!date) {
      errors.push({ line, message: `Date invalide : "${rawDate}"` })
      continue
    }

    const rawValueDate =
      mapping.valueDate != null ? (cells[mapping.valueDate] ?? '') : ''
    const valueDate = rawValueDate.trim()
      ? (parseFlexibleDate(rawValueDate) ?? date)
      : date

    const rawLabel = (cells[mapping.label!] ?? '').replace(/\s+/g, ' ').trim()

    let debit: number | null
    let credit: number | null

    if (mapping.amount != null) {
      const signed = parseAmount(cells[mapping.amount] ?? '', options.decimalSeparator)
      if (signed === null) {
        errors.push({ line, message: 'Montant manquant ou invalide' })
        continue
      }
      debit = signed < 0 ? signed : null
      credit = signed > 0 ? signed : null
    } else {
      const rawDebit = parseAmount(cells[mapping.debit!] ?? '', options.decimalSeparator)
      const rawCredit = parseAmount(cells[mapping.credit!] ?? '', options.decimalSeparator)

      if (rawDebit !== null && rawCredit !== null) {
        errors.push({ line, message: 'Débit et crédit renseignés tous les deux' })
        continue
      }
      if (rawDebit === null && rawCredit === null) {
        errors.push({ line, message: 'Montant manquant (débit et crédit vides)' })
        continue
      }

      debit =
        rawDebit === null
          ? null
          : options.debitSign === 'positive'
            ? -Math.abs(rawDebit)
            : rawDebit
      credit = rawCredit
    }

    const amount = debit ?? credit
    if (amount === null) {
      errors.push({ line, message: 'Montant manquant (débit et crédit vides)' })
      continue
    }

    let solde: number
    if (mapping.solde != null) {
      const parsedSolde = parseAmount(
        cells[mapping.solde] ?? '',
        options.decimalSeparator,
      )
      if (parsedSolde === null) {
        errors.push({ line, message: 'Solde manquant ou invalide' })
        continue
      }
      solde = parsedSolde
      runningBalance = solde
    } else {
      runningBalance = Math.round((runningBalance + amount) * 100) / 100
      solde = runningBalance
    }

    if (!rawLabel) {
      errors.push({ line, message: 'Libellé vide' })
      continue
    }

    rows.push({
      date,
      valueDate,
      debit,
      credit,
      amount,
      rawLabel,
      solde,
      merchantKey: buildMerchantKey(rawLabel),
    })
  }

  return { rows, errors }
}
