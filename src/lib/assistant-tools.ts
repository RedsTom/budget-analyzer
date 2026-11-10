/**
 * Outils mis à disposition de l'assistant conversationnel.
 *
 * Chaque outil est en lecture seule : il interroge le coffre déchiffré en
 * mémoire et renvoie un résumé compact (transmis au modèle) accompagné
 * d'artefacts visuels (cartes, graphiques) affichés dans le chat.
 *
 * Les artefacts ne contiennent jamais de copie figée des montants : seuls les
 * identifiants et les agrégats déjà calculés sont conservés, l'interface
 * recalcule l'affichage depuis l'état vivant du coffre.
 */

import { subMonths } from 'date-fns'
import {
  categoryBreakdown,
  merchantStats,
  monthlySeries,
  totalsForRange,
  transactionsInRange,
} from './analytics'
import { categoryById, categoryIdOf } from './categories'
import { resolveDisplayName } from './labels'
import type { DateRange } from './period'
import {
  detectRecurring,
  FREQUENCY_LABELS,
  type RecurringStatus,
} from './recurring'
import {
  balanceAt,
  balancePoints,
  coverageAvailability,
  detailedCoverageSegments,
  paymentAllocationStatuses,
  sortLedger,
} from './runway'
import {
  allocationParts,
  type AliasEntry,
  type AssistantArtifact,
  type BudgetPlan,
  type CustomAllocationMap,
  type RecurringDecision,
  type Transaction,
} from './types'

/* -------------------------------------------------------------------------- */
/* Contexte d'exécution                                                       */
/* -------------------------------------------------------------------------- */

export interface AssistantToolContext {
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  /** Période globale sélectionnée dans l'application. */
  range: DateRange
  label: string
  previousRange?: DateRange | null
  budgets?: BudgetPlan[]
  customAllocations?: CustomAllocationMap
  recurringDecisions?: Record<string, RecurringDecision>
  /** Date de référence (dernière opération du coffre), ISO `yyyy-mm-dd`. */
  reference?: string
}

export interface AssistantToolResult {
  /** Résumé compact, seul contenu renvoyé au modèle. */
  summary: Record<string, unknown>
  /** Cartes et graphiques ajoutés à la réponse. */
  artifacts: AssistantArtifact[]
}

/* -------------------------------------------------------------------------- */
/* Déclarations Gemini                                                        */
/* -------------------------------------------------------------------------- */

const RANGE_PARAMETERS = {
  months: {
    type: 'INTEGER',
    description:
      'Fenêtre en mois se terminant à la date de référence. Prioritaire sur la période affichée.',
  },
  date_start: { type: 'STRING', description: 'Début ISO yyyy-mm-dd (avec date_end).' },
  date_end: { type: 'STRING', description: 'Fin ISO yyyy-mm-dd incluse (avec date_start).' },
} as const

export const ASSISTANT_TOOL_DECLARATIONS = [
  {
    name: 'period_summary',
    description:
      'Totaux entrées/dépenses/net de la période, comparaison avec la période précédente et nombre d’opérations. Point de départ pour toute analyse chiffrée.',
    parameters: { type: 'OBJECT', properties: { ...RANGE_PARAMETERS } },
  },
  {
    name: 'search_transactions',
    description:
      'Recherche des opérations précises (virements, prélèvements, achats) par texte, montant, sens et période. Renvoie les identifiants à citer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Texte cherché dans le libellé, le marchand ou la catégorie.',
        },
        direction: {
          type: 'STRING',
          enum: ['expense', 'income', 'all'],
          description: 'Sens des opérations. Défaut : all.',
        },
        category: {
          type: 'STRING',
          description: 'Identifiant de catégorie (ex. alimentation, logement, revenus).',
        },
        min_amount: { type: 'NUMBER', description: 'Montant absolu minimal en euros.' },
        max_amount: { type: 'NUMBER', description: 'Montant absolu maximal en euros.' },
        limit: { type: 'INTEGER', description: 'Nombre maximum de résultats (défaut 10, max 30).' },
        ...RANGE_PARAMETERS,
      },
    },
  },
  {
    name: 'get_transaction',
    description:
      'Détail complet d’une opération par son identifiant : libellé bancaire, solde après opération, source, catégorie.',
    parameters: {
      type: 'OBJECT',
      properties: { id: { type: 'STRING', description: 'Identifiant de la transaction.' } },
      required: ['id'],
    },
  },
  {
    name: 'top_merchants',
    description:
      'Classement des marchands ou contreparties par volume sur une période, avec nombre d’opérations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['expense', 'income'], description: 'Défaut : expense.' },
        limit: { type: 'INTEGER', description: 'Nombre de marchands (défaut 8, max 20).' },
        ...RANGE_PARAMETERS,
      },
    },
  },
  {
    name: 'category_breakdown',
    description:
      'Répartition des dépenses ou des entrées par catégorie, avec part du total. Idéal pour un graphique en anneau.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['expense', 'income'], description: 'Défaut : expense.' },
        limit: { type: 'INTEGER', description: 'Nombre de catégories (défaut 8, max 15).' },
        ...RANGE_PARAMETERS,
      },
    },
  },
  {
    name: 'monthly_series',
    description:
      'Série mensuelle entrées/dépenses/net sur la période. À utiliser pour un graphique en barres ou une comparaison de mois.',
    parameters: {
      type: 'OBJECT',
      properties: { ...RANGE_PARAMETERS },
    },
  },
  {
    name: 'balance_history',
    description:
      'Évolution du solde bancaire sur les derniers jours, avec solde de départ, d’arrivée, minimum et maximum.',
    parameters: {
      type: 'OBJECT',
      properties: {
        days: { type: 'INTEGER', description: 'Profondeur en jours (défaut 90, max 365).' },
      },
    },
  },
  {
    name: 'budget_status',
    description:
      'Budgets mensuels configurés : plafond, dépense du mois de référence, reste disponible et dépassement.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'recurring_series',
    description:
      'Séries récurrentes détectées (abonnements, loyers, salaires) avec fréquence, montant mensuel, prochaine échéance et décision.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: {
          type: 'STRING',
          enum: ['accepted', 'pending', 'refused', 'all'],
          description: 'Défaut : accepted.',
        },
        limit: { type: 'INTEGER', description: 'Nombre de séries (défaut 10, max 30).' },
      },
    },
  },
  {
    name: 'coverage_status',
    description:
      'Couverture manuelle des dépenses par les crédits : quels revenus financent quoi, montant couvert et reste disponible.',
    parameters: {
      type: 'OBJECT',
      properties: { limit: { type: 'INTEGER', description: 'Nombre de crédits (défaut 8, max 20).' } },
    },
  },
  {
    name: 'allocations',
    description:
      'Affectations manuelles dépense -> crédit définies par l’utilisateur, avec montants des deux opérations.',
    parameters: {
      type: 'OBJECT',
      properties: { limit: { type: 'INTEGER', description: 'Nombre d’affectations (défaut 20, max 60).' } },
    },
  },
] as const

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asLimit(value: unknown, fallback: number, max: number): number {
  const parsed = asNumber(value)
  if (parsed === undefined) return fallback
  return Math.max(1, Math.min(max, Math.round(parsed)))
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
}

function referenceDate(context: AssistantToolContext): string {
  if (context.reference && ISO_DATE.test(context.reference)) return context.reference
  return context.transactions.reduce(
    (latest, transaction) => (transaction.date > latest ? transaction.date : latest),
    context.transactions[0]?.date ?? context.range.end,
  )
}

/** Fenêtre demandée par le modèle, sinon la période globale de l'application. */
export function resolveToolRange(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): DateRange {
  const start = asString(args.date_start)
  const end = asString(args.date_end)
  if (start && end && ISO_DATE.test(start) && ISO_DATE.test(end)) {
    return start <= end ? { start, end } : { start: end, end: start }
  }

  const months = asNumber(args.months)
  if (months !== undefined && months > 0) {
    const anchor = end && ISO_DATE.test(end) ? end : referenceDate(context)
    const from = subMonths(new Date(`${anchor}T00:00:00`), Math.min(120, Math.round(months)))
    const iso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(
      from.getDate(),
    ).padStart(2, '0')}`
    return { start: iso, end: anchor }
  }

  return context.range
}

function categoryName(transaction: Transaction, aliases: Record<string, AliasEntry>): string {
  return categoryById(categoryIdOf(transaction, aliases)).name
}

function shortLabel(transaction: Transaction, aliases: Record<string, AliasEntry>): string {
  const label = resolveDisplayName(transaction, aliases)
  return label.length > 70 ? `${label.slice(0, 67)}…` : label
}

function monthKeyOf(date: string): string {
  return date.slice(0, 7)
}

/** Dépenses d'un mois agrégées par catégorie effective. */
function expensesByCategory(
  transactions: Transaction[],
  aliases: Record<string, AliasEntry>,
  monthKey: string,
): { byCategory: Map<string, number>; total: number } {
  const byCategory = new Map<string, number>()
  let total = 0
  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== monthKey || transaction.amount >= 0) continue
    const amount = -transaction.amount
    const id = categoryIdOf(transaction, aliases)
    byCategory.set(id, (byCategory.get(id) ?? 0) + amount)
    total += amount
  }
  return { byCategory, total }
}

/* -------------------------------------------------------------------------- */
/* Exécuteurs                                                                 */
/* -------------------------------------------------------------------------- */

function runPeriodSummary(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const range = resolveToolRange(context, args)
  const totals = totalsForRange(context.transactions, range)
  const previous = context.previousRange
  const previousTotals =
    previous && previous.start <= previous.end ? totalsForRange(context.transactions, previous) : null

  return {
    summary: {
      periode: { debut: range.start, fin: range.end },
      entrees: round(totals.income),
      depenses: round(totals.expenses),
      net: round(totals.net),
      taux_epargne: totals.savingsRate === null ? null : round(totals.savingsRate * 100),
      operations: totals.count,
      periode_precedente: previousTotals
        ? {
            entrees: round(previousTotals.income),
            depenses: round(previousTotals.expenses),
            net: round(previousTotals.net),
          }
        : null,
    },
    artifacts: [],
  }
}

function runSearchTransactions(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const range = resolveToolRange(context, args)
  const query = asString(args.query)
  const direction = asString(args.direction) ?? 'all'
  const category = asString(args.category)
  const minAmount = asNumber(args.min_amount)
  const maxAmount = asNumber(args.max_amount)
  const limit = asLimit(args.limit, 10, 30)

  const terms = query ? normalize(query).split(/\s+/).filter(Boolean).slice(0, 6) : []

  const matches = transactionsInRange(context.transactions, range).filter((transaction) => {
    if (direction === 'expense' && transaction.amount >= 0) return false
    if (direction === 'income' && transaction.amount <= 0) return false
    if (category && categoryIdOf(transaction, context.aliases) !== category) return false
    const absolute = Math.abs(transaction.amount)
    if (minAmount !== undefined && absolute < minAmount) return false
    if (maxAmount !== undefined && absolute > maxAmount) return false
    if (terms.length === 0) return true

    const haystack = normalize(
      [
        transaction.rawLabel,
        resolveDisplayName(transaction, context.aliases),
        transaction.merchantKey,
        categoryName(transaction, context.aliases),
      ].join(' '),
    )
    return terms.every((term) => haystack.includes(term))
  })

  const ordered = [...matches]
    .sort((a, b) => (a.date === b.date ? Math.abs(b.amount) - Math.abs(a.amount) : b.date.localeCompare(a.date)))
    .slice(0, limit)

  const title = query ? `Opérations « ${query} »` : 'Opérations trouvées'

  return {
    summary: {
      periode: { debut: range.start, fin: range.end },
      correspondances: matches.length,
      affichees: ordered.length,
      total_affiche: round(ordered.reduce((sum, transaction) => sum + transaction.amount, 0)),
      operations: ordered.map((transaction) => ({
        id: transaction.id,
        date: transaction.date,
        libelle: shortLabel(transaction, context.aliases),
        montant: round(transaction.amount),
        categorie: categoryName(transaction, context.aliases),
        solde_apres: round(transaction.solde),
      })),
    },
    artifacts:
      ordered.length > 0
        ? [{ type: 'transactions', title, ids: ordered.map((transaction) => transaction.id) }]
        : [],
  }
}

function runGetTransaction(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const id = asString(args.id)
  const transaction = id ? context.transactions.find((item) => item.id === id) : undefined
  if (!transaction) {
    return {
      summary: { trouvee: false, message: 'Aucune opération ne correspond à cet identifiant.' },
      artifacts: [],
    }
  }

  return {
    summary: {
      trouvee: true,
      id: transaction.id,
      date: transaction.date,
      libelle: resolveDisplayName(transaction, context.aliases),
      libelle_bancaire: transaction.rawLabel,
      montant: round(transaction.amount),
      sens: transaction.amount < 0 ? 'depense' : 'entree',
      categorie: categoryName(transaction, context.aliases),
      solde_apres: round(transaction.solde),
      source: transaction.isManual ? 'saisie manuelle' : transaction.sourceFile,
      note: transaction.note ?? null,
    },
    artifacts: [
      {
        type: 'transactions',
        title: shortLabel(transaction, context.aliases),
        ids: [transaction.id],
      },
    ],
  }
}

function runTopMerchants(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const range = resolveToolRange(context, args)
  const direction = asString(args.direction) === 'income' ? 'income' : 'expense'
  const limit = asLimit(args.limit, 8, 20)

  const stats = merchantStats(context.transactions, range, context.aliases)
    .filter((merchant) => (direction === 'expense' ? merchant.expenses > 0 : merchant.income > 0))
    .map((merchant) => ({
      merchantKey: merchant.merchantKey,
      name: merchant.label,
      total: direction === 'expense' ? merchant.expenses : merchant.income,
      count: merchant.count,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)

  return {
    summary: {
      periode: { debut: range.start, fin: range.end },
      sens: direction === 'expense' ? 'depenses' : 'entrees',
      marchands: stats.map((merchant) => ({
        nom: merchant.name,
        total: round(merchant.total),
        operations: merchant.count,
      })),
    },
    artifacts:
      stats.length > 0
        ? [
            {
              type: 'merchants',
              title: direction === 'expense' ? 'Principaux marchands' : 'Principales contreparties',
              items: stats.map((merchant) => ({
                ...merchant,
                total: round(merchant.total),
              })),
            },
          ]
        : [],
  }
}

function runCategoryBreakdown(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const range = resolveToolRange(context, args)
  const direction = asString(args.direction) === 'income' ? 'income' : 'expense'
  const limit = asLimit(args.limit, 8, 15)

  const slices = categoryBreakdown(context.transactions, range, context.aliases, direction)
    .filter((slice) => slice.total > 0)
    .slice(0, limit)
  const total = slices.reduce((sum, slice) => sum + slice.total, 0)

  return {
    summary: {
      periode: { debut: range.start, fin: range.end },
      sens: direction === 'expense' ? 'depenses' : 'entrees',
      total: round(total),
      categories: slices.map((slice) => ({
        nom: slice.name,
        total: round(slice.total),
        part: round(slice.share * 100),
      })),
    },
    artifacts:
      slices.length > 0
        ? [
            {
              type: 'categories',
              title: direction === 'expense' ? 'Dépenses par catégorie' : 'Entrées par catégorie',
              direction,
              total: round(total),
              items: slices.map((slice) => ({
                id: slice.id,
                name: slice.name,
                color: slice.color,
                total: round(slice.total),
                share: slice.share,
              })),
            },
          ]
        : [],
  }
}

function runMonthlySeries(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const range = resolveToolRange(context, args)
  const points = monthlySeries(context.transactions, range).slice(-24)

  return {
    summary: {
      periode: { debut: range.start, fin: range.end },
      mois: points.map((point) => ({
        mois: point.month,
        entrees: round(point.income),
        depenses: round(point.expenses),
        net: round(point.net),
      })),
    },
    artifacts:
      points.length > 0
        ? [
            {
              type: 'monthly',
              title: 'Évolution mensuelle',
              points: points.map((point) => ({
                month: point.month,
                label: point.label,
                income: round(point.income),
                expenses: round(point.expenses),
              })),
            },
          ]
        : [],
  }
}

function runBalanceHistory(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const days = asLimit(args.days, 90, 365)
  const end = referenceDate(context)
  const endTime = new Date(`${end}T00:00:00`).getTime()
  const startTime = endTime - days * 24 * 60 * 60 * 1000
  const start = new Date(startTime).toISOString().slice(0, 10)

  const all = balancePoints(context.transactions)
  const scoped = all.filter((point) => point.date >= start && point.date <= end)
  const opening = all.findLast((point) => point.date < start)
  const series = opening ? [{ ...opening, date: start }, ...scoped] : scoped

  // Échantillonnage régulier pour ne pas envoyer 365 points au modèle.
  const step = Math.max(1, Math.ceil(series.length / 120))
  const sampled =
    series.length <= 120
      ? series
      : series.filter((_, index) => index % step === 0 || index === series.length - 1)

  const values = series.map((point) => point.balance)
  const latest = series.at(-1)?.balance ?? balanceAt(context.transactions, end)

  return {
    summary: {
      periode: { debut: start, fin: end },
      solde_initial: round(series[0]?.balance ?? 0),
      solde_final: round(latest),
      minimum: round(Math.min(...values)),
      maximum: round(Math.max(...values)),
      points: series.length,
    },
    artifacts:
      sampled.length > 0
        ? [
            {
              type: 'balance',
              title: `Solde sur ${days} jours`,
              points: sampled.map((point) => ({ date: point.date, balance: round(point.balance) })),
            },
          ]
        : [],
  }
}

function runBudgetStatus(context: AssistantToolContext): AssistantToolResult {
  const monthKey = monthKeyOf(referenceDate(context))
  const month = expensesByCategory(context.transactions, context.aliases, monthKey)
  const budgets = context.budgets ?? []

  const items = budgets.map((budget) => {
    const scoped = !budget.categoryId || budget.categoryId === 'all'
    const spent = scoped ? month.total : (month.byCategory.get(budget.categoryId!) ?? 0)
    return {
      id: budget.id,
      name: budget.name,
      category: budget.categoryId ? categoryById(budget.categoryId).name : 'Toutes catégories',
      limit: round(budget.monthlyLimit),
      spent: round(spent),
    }
  })

  const exceeded = items.filter((item) => item.spent > item.limit)

  return {
    summary: {
      mois: monthKey,
      depenses_du_mois: round(month.total),
      budgets: items.map((item) => ({
        nom: item.name,
        categorie: item.category,
        plafond: item.limit,
        depense: item.spent,
        reste: round(item.limit - item.spent),
        depasse: item.spent > item.limit,
      })),
      depassements: exceeded.length,
    },
    artifacts:
      items.length > 0
        ? [{ type: 'budgets', title: `Budgets de ${monthKey}`, items }]
        : [],
  }
}

function runRecurringSeries(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const status = asString(args.status) ?? 'accepted'
  const limit = asLimit(args.limit, 10, 30)
  const reference = referenceDate(context)

  const series = detectRecurring(context.transactions, {
    reference,
    decisions: context.recurringDecisions ?? {},
    aliases: context.aliases,
  })
    .filter((item) => {
      if (status === 'all') return true
      return item.decision === (status as RecurringStatus)
    })
    .filter((item) => status === 'all' || status === 'refused' || item.active)
    .slice(0, limit)

  const monthlyExpense = series
    .filter((item) => item.direction === 'expense')
    .reduce((sum, item) => sum + item.monthlyAmount, 0)
  const monthlyIncome = series
    .filter((item) => item.direction === 'income')
    .reduce((sum, item) => sum + item.monthlyAmount, 0)

  return {
    summary: {
      filtre: status,
      total_mensuel_depenses: round(monthlyExpense),
      total_mensuel_entrees: round(monthlyIncome),
      series: series.map((item) => ({
        id: item.id,
        libelle: item.label,
        montant_mensuel: round(item.monthlyAmount),
        sens: item.direction === 'expense' ? 'depense' : 'entree',
        frequence: FREQUENCY_LABELS[item.frequency],
        prochaine_echeance: item.nextDate,
        decision: item.decision,
      })),
    },
    artifacts:
      series.length > 0
        ? [
            {
              type: 'recurring',
              title:
                status === 'accepted'
                  ? 'Charges récurrentes acceptées'
                  : status === 'pending'
                    ? 'Récurrences en attente'
                    : status === 'refused'
                      ? 'Récurrences refusées'
                      : 'Séries récurrentes',
              items: series.map((item) => ({
                id: item.id,
                label: item.label,
                amount: round(item.monthlyAmount),
                direction: item.direction,
                frequency: FREQUENCY_LABELS[item.frequency],
                nextDate: item.nextDate,
                decision: item.decision,
              })),
            },
          ]
        : [],
  }
}

function runCoverageStatus(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const limit = asLimit(args.limit, 8, 20)
  const allSegments = detailedCoverageSegments(
    context.transactions,
    context.customAllocations ?? {},
    context.aliases,
  )
  const balance = sortLedger(context.transactions).at(-1)?.solde ?? 0
  const availability = coverageAvailability(allSegments, balance)
  const remainingOf = (segment: (typeof allSegments)[number]): number =>
    availability.availableByCredit[segment.creditId] ?? 0
  const activeCount = allSegments.filter((segment) => remainingOf(segment) > 0.005).length
  const paymentStatuses = paymentAllocationStatuses(
    context.transactions,
    context.customAllocations,
    context.aliases,
  )
  const pendingPayments = paymentStatuses.filter(
    (payment) => payment.status !== 'done',
  ).length
  const segments = allSegments
    .filter((segment) => segment.coveredAmount > 0 || remainingOf(segment) > 0.005)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)

  return {
    summary: {
      credits_actifs: activeCount,
      reste_disponible: round(availability.available),
      deficit_absorbe: round(availability.absorbedDeficit),
      paiements_a_traiter: pendingPayments,
      credits: segments.map((segment) => ({
        credit_id: segment.creditId,
        libelle: segment.displayName,
        montant: round(segment.amount),
        couvert: round(segment.coveredAmount),
        restant: round(remainingOf(segment)),
        couvre_jusqu_au: segment.coversUntil,
        duree_jours: segment.durationDays,
        categories_financees: Object.entries(segment.categoryTotals)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([id, total]) => ({ categorie: categoryById(id).name, total: round(total) })),
      })),
    },
    artifacts:
      segments.length > 0
        ? [
            {
              type: 'coverage',
              title: 'Couverture par les crédits',
              items: segments.map((segment) => ({
                creditId: segment.creditId,
                label: segment.displayName,
                amount: round(segment.amount),
                covered: round(segment.coveredAmount),
                remaining: round(remainingOf(segment)),
                coversUntil: segment.coversUntil,
              })),
            },
          ]
        : [],
  }
}

function runAllocations(
  context: AssistantToolContext,
  args: Record<string, unknown>,
): AssistantToolResult {
  const limit = asLimit(args.limit, 20, 60)
  const byId = new Map(context.transactions.map((transaction) => [transaction.id, transaction]))

  const items = Object.entries(context.customAllocations ?? {})
    .flatMap(([expenseId, value]) => {
      const expense = byId.get(expenseId)
      if (!expense || expense.amount >= 0) return []
      return allocationParts(value, -expense.amount).flatMap((part) => {
        const credit = byId.get(part.creditId)
        if (!credit) return []
        return [
          {
            expenseId,
            expenseLabel: shortLabel(expense, context.aliases),
            expenseAmount: round(expense.amount),
            creditId: part.creditId,
            creditLabel: shortLabel(credit, context.aliases),
            creditAmount: round(credit.amount),
            partAmount: part.amount,
            date: expense.date,
          },
        ]
      })
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)

  return {
    summary: {
      nombre: items.length,
      affectations: items.map((item) => ({
        depense: item.expenseLabel,
        montant_depense: item.expenseAmount,
        credit: item.creditLabel,
        montant_credit: item.creditAmount,
        montant_part: item.partAmount,
      })),
    },
    artifacts:
      items.length > 0
        ? [
            {
              type: 'allocations',
              title: 'Affectations manuelles',
              items: items.map((item) => ({
                expenseId: item.expenseId,
                expenseLabel: item.expenseLabel,
                expenseAmount: item.expenseAmount,
                creditId: item.creditId,
                creditLabel: item.creditLabel,
                creditAmount: item.creditAmount,
                partAmount: item.partAmount,
              })),
            },
          ]
        : [],
  }
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Exécute un outil demandé par le modèle. Toute erreur est levée pour être
 * transformée en réponse d'outil en échec côté appelant.
 */
export function runAssistantTool(
  name: string,
  args: Record<string, unknown>,
  context: AssistantToolContext,
): AssistantToolResult {
  switch (name) {
    case 'period_summary':
      return runPeriodSummary(context, args)
    case 'search_transactions':
      return runSearchTransactions(context, args)
    case 'get_transaction':
      return runGetTransaction(context, args)
    case 'top_merchants':
      return runTopMerchants(context, args)
    case 'category_breakdown':
      return runCategoryBreakdown(context, args)
    case 'monthly_series':
      return runMonthlySeries(context, args)
    case 'balance_history':
      return runBalanceHistory(context, args)
    case 'budget_status':
      return runBudgetStatus(context)
    case 'recurring_series':
      return runRecurringSeries(context, args)
    case 'coverage_status':
      return runCoverageStatus(context, args)
    case 'allocations':
      return runAllocations(context, args)
    default:
      throw new Error(`Outil inconnu : ${name}`)
  }
}
