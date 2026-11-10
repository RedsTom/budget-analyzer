import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

const percent = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
})

const integers = new Intl.NumberFormat('fr-FR')

export function formatCount(value: number): string {
  return integers.format(value)
}

export function formatPercent(value: number): string {
  // Intl affiche « -0 % » pour les valeurs négatives infinitésimales.
  return percent.format(Math.abs(value) < 0.0005 ? 0 : value)
}

export function formatSignedAmount(value: number): string {
  return `${value > 0 ? '+' : ''}${euros.format(value)}`
}

export function formatAmount(value: number): string {
  return euros.format(value)
}

export function formatCompactAmount(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1000) {
    return `${new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 1,
      notation: 'compact',
    }).format(value)} €`
  }
  return `${Math.round(value)} €`
}

export function formatDate(iso: string): string {
  return format(parseISO(iso), 'd MMM yyyy', { locale: fr })
}

export function formatMonth(month: string): string {
  return format(parseISO(`${month}-01`), 'MMMM yyyy', { locale: fr })
}
