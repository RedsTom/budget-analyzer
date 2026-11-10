/**
 * Nettoyage des libellés bancaires et clé de regroupement marchand.
 *
 * Les libellés sont tronqués par la banque, il ne faut donc pas viser
 * l'exactitude : l'utilisateur peut toujours renommer, et l'alias est
 * persisté par `merchantKey` pour les imports futurs.
 */

const REFERENCE_PATTERNS = [
  /\b(?:HIR|HIL|HIP|HIA)[A-Z0-9]{8,}\b/g,
  /\bCH3[A-Z0-9]{8,}\b/g,
  /\bWRHIS\d+\b/g,
  /\bREF[0-9A-Z]{5,}\b/g,
  // Références bancaires : LPAM0090102493, PAYLI2441535, BF5311109, VH33362JEPK3PA01…
  /\b[A-Z]{2,6}\d{5,}[A-Z0-9]*\b/g,
  // Empreintes et jetons mixtes longs : F5A8B6F42E4B482B…, 3Z57UANMYNH0GR94…
  /\b(?=[A-Z0-9]{10,}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}\b/g,
  // Préfixes de paiement sans numéro : PAYLIB, PAYLI, PAYWEB.
  /\b(?:PAYLIB|PAYLI|PAYWEB)\b/g,
  /\b\d{7,}\b/g,
]

const CARD_PATTERN = /\s+CARTE\s+\d+.*$/i
const PREFIX_PATTERN =
  /^(?:\d+\s+PAIEMENTS?|PAIEMENT\s+(?:PSC|CB|MOB))\s+\d{4}\s+|^(?:PRLV\s+SEPA|VIR\s+(?:INST|DE|SEPA|LIVRET)|VIREMENT\s+(?:DE|VERS)|RETRAIT\s+DAB\s+\d{4}|F\s+(?:COTIS|RETRO))\s+/i
const TRAILING_REFERENCE = /\s*\/.*$|[-/]+$/g

/** Villes présentes dans les libellés de l'export ; retirées pour regrouper. */
const CITY_TOKENS = [
  'CLERMONT FERR',
  'CLERMONT-FERR',
  'CLERMONT',
  'AUBIERE',
  'NEYRON',
  'ROMAGNAT',
  'ORCINES',
  'MARSEILLE',
  'PARIS',
  'LONDON',
  'LUXEMBOURG',
  'DUBLIN',
]

const NOISE_TOKENS = new Set(['MLE', 'MME', 'MR', 'M'])

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripReferences(value: string): string {
  let result = value
  for (const pattern of REFERENCE_PATTERNS) result = result.replace(pattern, ' ')
  return result
}

/** Libellé lisible, sans préfixe bancaire, carte, référence ni ville. */
export function cleanLabel(rawLabel: string): string {
  let value = normalizeWhitespace(rawLabel)
  if (!value) return ''

  value = stripReferences(value)
  value = value.replace(CARD_PATTERN, '')
  value = value.replace(PREFIX_PATTERN, '')
  value = value.replace(/^(?:MLE|MME|MR|M)\.?\s+/i, '')

  for (const city of CITY_TOKENS) {
    const pattern = new RegExp(`\\b${city.replace('-', '[- ]')}\\b`, 'gi')
    value = value.replace(pattern, ' ')
  }

  value = value.replace(TRAILING_REFERENCE, ' ')
  value = value.replace(/\b\d{4}\b/g, ' ')
  value = normalizeWhitespace(value)

  return value
}

/** Clé stable de regroupement : majuscules, sans accents ni ponctuation. */
export function buildMerchantKey(rawLabel: string): string {
  const cleaned = cleanLabel(rawLabel)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(' ')
    .filter((token) => token && !NOISE_TOKENS.has(token))
    .slice(0, 5)
    .join(' ')
    .trim()

  return cleaned || 'INCONNU'
}

/** Nom d'affichage automatique ; l'utilisateur peut le remplacer via un alias. */
export function autoDisplayName(rawLabel: string): string {
  const cleaned = cleanLabel(rawLabel)
  if (!cleaned) return rawLabel

  return cleaned
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[\s\-/])([\p{L}])/gu, (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('fr-FR'))
}

/** Applique la priorité : renommage de la transaction > alias marchand > auto. */
export function resolveDisplayName(
  transaction: { rawLabel: string; merchantKey: string; displayName?: string },
  aliases: Record<string, { displayName?: string }>,
): string {
  return (
    transaction.displayName ||
    aliases[transaction.merchantKey]?.displayName ||
    autoDisplayName(transaction.rawLabel)
  )
}
