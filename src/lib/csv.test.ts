import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodeCsvBytes,
  inspectCsvText,
  parseAmount,
  parseCsvText,
  parseFlexibleDate,
  parseFrenchDate,
} from './csv'

const complete = readFileSync(
  new URL('../../00021876101(1).csv', import.meta.url),
)
const partial = readFileSync(new URL('../../00021876101.csv', import.meta.url))

describe('décodage', () => {
  it('décode le Windows-1252 (é = 0xE9), pas l’UTF-8', () => {
    expect(decodeCsvBytes(Uint8Array.from([0x44, 0xe9, 0x62, 0x69, 0x74]))).toBe(
      'Débit',
    )
  })
})

describe('parseAmount', () => {
  it('gère la virgule, le signe et les espaces insécables', () => {
    expect(parseAmount('1 500,00')).toBe(1500)
    expect(parseAmount('-6,99')).toBe(-6.99)
    expect(parseAmount('40,00')).toBe(40)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })

  it('reconnaît les formats internationaux', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('1.234')).toBe(1234)
    expect(parseAmount('(12,50)')).toBe(-12.5)
    expect(parseAmount('12,50-')).toBe(-12.5)
    expect(parseAmount('€ 1 234,56')).toBe(1234.56)
  })
})

describe('parseFlexibleDate', () => {
  it('accepte les dates ISO, françaises et sur deux chiffres', () => {
    expect(parseFlexibleDate('2026-08-25')).toBe('2026-08-25')
    expect(parseFlexibleDate('2026-08-25T12:00:00Z')).toBe('2026-08-25')
    expect(parseFlexibleDate('25/08/2026')).toBe('2026-08-25')
    expect(parseFlexibleDate('25-08-2026')).toBe('2026-08-25')
    expect(parseFlexibleDate('25/08/26')).toBe('2026-08-25')
    expect(parseFlexibleDate('31/02/2026')).toBeNull()
  })
})

describe('parseFrenchDate', () => {
  it('convertit en ISO et rejette les dates impossibles', () => {
    expect(parseFrenchDate('25/08/2026')).toBe('2026-08-25')
    expect(parseFrenchDate('31/02/2026')).toBeNull()
    expect(parseFrenchDate('2026-08-25')).toBeNull()
  })
})

describe('parseCsvText', () => {
  it('parse l’historique complet', () => {
    const { rows, errors } = parseCsvText(complete.toString('latin1'))
    expect(rows).toHaveLength(1728)
    expect(errors).toHaveLength(0)
    expect(rows.some((row) => row.rawLabel.includes('\uFFFD'))).toBe(false)

    expect(rows[0]).toMatchObject({
      date: '2023-10-23',
      valueDate: '2023-10-23',
      debit: null,
      credit: 50,
      amount: 50,
      solde: 50,
    })
    expect(rows[2].debit).toBe(-4.5)
    expect(rows[2].amount).toBe(-4.5)
  })

  it('parse l’export court', () => {
    const { rows, errors } = parseCsvText(partial.toString('latin1'))
    expect(rows).toHaveLength(198)
    expect(errors).toHaveLength(0)
    expect(rows[0].date).toBe('2026-08-25')
  })

  it('signale les lignes invalides sans bloquer le reste', () => {
    const csv = [
      'Date;Date de valeur;Débit;Crédit;Libellé;Solde',
      '25/08/2026;25/08/2026;;40,00;VIR TEST;59,21',
      'nope;25/08/2026;-10,00;;CASSE;49,21',
      '26/08/2026;26/08/2026;;;SANS MONTANT;49,21',
      '27/08/2026;27/08/2026;-1,00;;TEST;48,21',
    ].join('\n')

    const { rows, errors } = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(errors).toHaveLength(2)
  })

  it('détecte les en-têtes anglais et un montant signé', () => {
    const csv = [
      'Booking date;Description;Amount;Balance',
      '2026-01-05;Coffee shop;-4.50;100.00',
      '2026-01-06;Salary;1500.00;1600.00',
    ].join('\n')

    const inspection = inspectCsvText(csv)
    expect(inspection.delimiter).toBe(';')
    expect(inspection.complete).toBe(true)

    const { rows, errors } = parseCsvText(csv)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      date: '2026-01-05',
      debit: -4.5,
      credit: null,
      amount: -4.5,
      solde: 100,
    })
    expect(rows[1]).toMatchObject({ credit: 1500, debit: null })
  })

  it('accepte un mappage manuel et reconstruit le solde', () => {
    const csv = [
      'Quand;Quoi;Combien',
      '05/01/2026;Pain;-2,50',
      '06/01/2026;Salaire;10,00',
    ].join('\n')

    const inspection = inspectCsvText(csv)
    expect(inspection.complete).toBe(false)

    const { rows, errors } = parseCsvText(csv, {
      mapping: { date: 0, label: 1, amount: 2 },
    })
    expect(errors).toHaveLength(0)
    expect(rows.map((row) => row.solde)).toEqual([-2.5, 7.5])
    expect(rows[0].amount).toBe(-2.5)
  })

  it('inverse les débits exportés en positif', () => {
    const csv = [
      'Date;Libellé;Débit;Crédit',
      '05/01/2026;Achat;12,50;',
      '06/01/2026;Salaire;;100,00',
    ].join('\n')

    const { rows } = parseCsvText(csv, { debitSign: 'positive' })
    expect(rows[0].amount).toBe(-12.5)
    expect(rows[1].amount).toBe(100)
  })

  it('détecte le séparateur virgule et les montants US', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-01-05,Coffee,-4.50',
      '2026-01-06,Salary,"1,500.00"',
    ].join('\n')

    const inspection = inspectCsvText(csv)
    expect(inspection.delimiter).toBe(',')

    const { rows } = parseCsvText(csv)
    expect(rows.map((row) => row.amount)).toEqual([-4.5, 1500])
  })
})
