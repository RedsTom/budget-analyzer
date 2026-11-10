import type { AliasEntry, Category } from './types'

export type CategoryId =
  | 'alimentation'
  | 'restaurants'
  | 'transport'
  | 'logement'
  | 'energie'
  | 'abonnements'
  | 'shopping'
  | 'loisirs'
  | 'sante'
  | 'assurances'
  | 'credits'
  | 'banque'
  | 'transferts'
  | 'revenus'
  | 'autres'

export interface CategoryDefinition extends Category {
  id: CategoryId
  name: string
  color: string
  description: string
}

export const CATEGORIES: CategoryDefinition[] = [
  { id: 'alimentation', name: 'Alimentation', color: '#10b981', description: 'Courses, marchés, boulangeries' },
  { id: 'restaurants', name: 'Restaurants & cafés', color: '#f59e0b', description: 'Restaurants, livraison, cantines' },
  { id: 'transport', name: 'Transport', color: '#3b82f6', description: 'Train, métro, vélo, carburant' },
  { id: 'logement', name: 'Logement', color: '#6366f1', description: 'Loyer, charges, syndic' },
  { id: 'energie', name: 'Énergie', color: '#f97316', description: 'Électricité, gaz, eau' },
  { id: 'abonnements', name: 'Abonnements', color: '#a855f7', description: 'Streaming, logiciels, cloud' },
  { id: 'shopping', name: 'Shopping', color: '#ec4899', description: 'En ligne, mode, maison' },
  { id: 'loisirs', name: 'Loisirs', color: '#06b6d4', description: 'Jeux, sorties, culture, paris' },
  { id: 'sante', name: 'Santé', color: '#14b8a6', description: 'Pharmacie, médecins, optique' },
  { id: 'assurances', name: 'Assurances', color: '#64748b', description: 'Habitation, auto, mutuelle' },
  { id: 'credits', name: 'Crédits', color: '#ef4444', description: 'Prêts et remboursements' },
  { id: 'banque', name: 'Banque', color: '#78716c', description: 'Frais, cotisations, commissions' },
  { id: 'transferts', name: 'Transferts', color: '#8b5cf6', description: 'Virements entre comptes, famille' },
  { id: 'revenus', name: 'Revenus', color: '#22c55e', description: 'Salaire, aides, remboursements' },
  { id: 'autres', name: 'Non classé', color: '#94a3b8', description: 'À classer manuellement' },
]

const BY_ID = new Map<string, CategoryDefinition>(
  CATEGORIES.map((category) => [category.id, category]),
)

const FALLBACK: CategoryDefinition = BY_ID.get('autres')!

export function categoryById(id: string | undefined): CategoryDefinition {
  return (id && BY_ID.get(id)) || FALLBACK
}

export function isCategoryId(id: string): id is CategoryId {
  return BY_ID.has(id)
}

/**
 * Règles heuristiques ordonnées : les plus spécifiques d'abord.
 * Elles portent sur la clé marchand et le libellé brut, jamais sur le nom
 * renommé (sinon un renommage changerait la catégorie automatique).
 */
const RULES: { id: CategoryId; keywords: string[] }[] = [
  {
    id: 'revenus',
    keywords: [
      'DRFIP',
      'SALAIRE',
      'REMUNERATION',
      'PAYE',
      'PAYES',
      'CAF',
      'POLE EMPLOI',
      'RETRAITE',
      'PENSION',
      'ALLOCATION',
      'BOURSE',
      'PRIME',
      'INTERESSEMENT',
    ],
  },
  {
    id: 'banque',
    keywords: [
      'F COMM',
      'COMMISSION',
      'COTISATION',
      'COTIS',
      'EUROCOMPTE',
      'CONNECT ORIGINE',
      'FRAIS',
      'INTERVENTION',
      'TENUE DE COMPTE',
      'LCL',
      'BNP',
      'SOCIETE GENERALE',
      'CREDIT AGRICOLE',
      'CAISSE D EPARGNE',
      'BANQUE POSTALE',
    ],
  },
  {
    id: 'credits',
    keywords: ['ECH PRET', 'PRET', 'CREDIT IMMOBILIER', 'CREDIT CONSO', 'REMBOURSEMENT PRET'],
  },
  {
    id: 'assurances',
    keywords: ['ASSURANCE', 'MUTUELLE', 'MAIF', 'MACIF', 'AXA', 'MATMUT', 'GROUPAMA'],
  },
  {
    id: 'logement',
    keywords: ['LOYER', 'IMMOBILIER', 'SYNDIC', 'HABITATION', 'CHARGES LOCATIVES'],
  },
  {
    id: 'energie',
    keywords: ['EDF', 'ENGIE', 'TOTALENERGIES', 'GAZ', 'ELECTRICITE', 'VEOLIA', 'SUEZ', 'CHAUFFAGE'],
  },
  {
    id: 'abonnements',
    keywords: [
      'NETFLIX',
      'SPOTIFY',
      'DEEZER',
      'DISNEY',
      'YOUTUBE',
      'GOOGLE PLAY',
      'GOOGLE ONE',
      'ITUNES',
      'APPLE',
      'MICROSOFT',
      'ADOBE',
      'AMAZON PRIME',
      'PLAYSTATION',
      'XBOX',
      'NINTENDO',
      'OPENAI',
      'CHATGPT',
      'CANVA',
      'DROPBOX',
      'ICLOUD',
    ],
  },
  {
    id: 'loisirs',
    keywords: [
      'STEAM',
      'WINAMAX',
      'CINEMA',
      'MUSEE',
      'BILLET',
      'VRST',
      'GORILLA EVENTS',
      'THEATRE',
      'CONCERT',
      'SALLE DE SPORT',
      'BASIC FIT',
      'FITNESS',
      'HOTEL',
      'BOOKING',
      'AIRBNB',
      'BOWLING',
      'Z EVENT',
      'VIRTUAL ROOM',
      'CHATEAU',
      'LABYRINTHE',
      'PARC',
      'KARTING',
      'PATINOIRE',
    ],
  },
  {
    id: 'transport',
    keywords: [
      'RATP',
      'SNCF',
      'TCL',
      'CITYBIKE',
      'VOI',
      'BLABLACAR',
      'ESSENCE',
      'CARBURANT',
      'PARKING',
      'PEAGE',
      'LA METROPOLE',
      'TISSEO',
      'UBER',
      'AUTO ECOLE',
      'CENTRE DE CONDUI',
      'REGIE TRANSP',
      'TRAIN',
      'AVION',
    ],
  },
  {
    id: 'sante',
    keywords: ['PHARMACIE', 'MEDECIN', 'DOCTEUR', 'HOPITAL', 'OPTIQUE', 'DENTISTE', 'CLINIQUE', 'LABORATOIRE'],
  },
  {
    id: 'restaurants',
    keywords: [
      'RESTAURANT',
      'RESTO',
      'BURGER KING',
      'MC DO',
      'MCDONALD',
      'KFC',
      'DELIVEROO',
      'UBER EATS',
      'PIZZA',
      'SUSHI',
      'DONER',
      'TABAC',
      'CAFE',
      'COFFEE',
      'IZLY',
      'CROUS',
      'RU LUMINY',
      'BOULANGERIE',
      'PATISSERIE',
      'BRASSERIE',
      'TAVERNE',
      'CREPERIE',
      'PIZZERIA',
      'KEBAB',
      'RAMEN',
      'JAPONAIS',
      'GRILL',
      'ESTANCO',
      'CHNACK',
      'SUSHI SHOP',
      'MAXICOFFEE',
    ],
  },
  {
    id: 'alimentation',
    keywords: [
      'LIDL',
      'CARREFOUR',
      'INTERMARCHE',
      'INTERMARCH',
      'INTERMACH',
      'MONOPRIX',
      'AUCHAN',
      'LECLERC',
      'FRANPRIX',
      'PICARD',
      'CASINO',
      'SUPER U',
      'ALIMENTATION',
      'EPICERIE',
      'EPICAR',
      'MARKET',
      'PROXI',
      'BIOCOOP',
      'GRAND FRAIS',
      'ALDI',
      'MERCADONA',
      'SUPERMARCHE',
      'SUPER MARCHE',
    ],
  },
  {
    id: 'shopping',
    keywords: [
      'AMAZON',
      'ALIEXPRESS',
      'IKEA',
      'SHEIN',
      'ZARA',
      'H&M',
      'DECATHLON',
      'FNAC',
      'DARTY',
      'CDISCOUNT',
      'REDUIT',
      'ACTION',
      'LEROY MERLIN',
      'BRICORAMA',
      'BOULANGER',
      'SCALAPAY',
      'CULTURA',
      'GIFI',
      'CENTRAKOR',
      'TEMU',
    ],
  },
  {
    id: 'transferts',
    keywords: [
      'VIR DE',
      'VIR LIVRET',
      'VIREMENT',
      'VIR INST',
      'VIR SEPA',
      'WERO',
      'TIRELIRE',
      'REVOLUT',
      'N26',
      'XPOLLENS',
      'LIVRET',
    ],
  },
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const COMPILED_RULES = RULES.map((rule) => ({
  id: rule.id,
  patterns: rule.keywords.map(
    (keyword) => new RegExp(`\\b${escapeRegExp(normalize(keyword))}\\b`),
  ),
}))

/** Catégorie automatique, déduite du marchand et du libellé d'origine. */
export function autoCategoryId(input: {
  merchantKey: string
  rawLabel: string
  amount: number
}): CategoryId {
  const haystack = normalize(`${input.merchantKey} ${input.rawLabel}`)

  for (const rule of COMPILED_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.id
  }

  return input.amount > 0 ? 'transferts' : 'autres'
}

/** Priorité : catégorie ponctuelle > catégorie du marchand (alias) > heuristique. */
export function categoryIdOf(
  transaction: {
    merchantKey: string
    rawLabel: string
    amount: number
    categoryId?: string
  },
  aliases: Record<string, AliasEntry>,
): CategoryId {
  if (transaction.categoryId && isCategoryId(transaction.categoryId)) {
    return transaction.categoryId
  }
  const assigned = aliases[transaction.merchantKey]?.categoryId
  if (assigned && isCategoryId(assigned)) return assigned
  return autoCategoryId(transaction)
}
