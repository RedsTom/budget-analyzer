/**
 * Intégration de l'IA via l'API Google Gemini.
 *
 * Principes et confidentialité :
 * - Totalement opt-in : aucune requête n'est émise sans action de l'utilisateur.
 * - La clé API est stockée de manière chiffrée dans le coffre local.
 * - Minimisation des données : seuls les libellés bancaires bruts (sans montant,
 *   sans solde, sans nom personnel) sont transmis pour suggérer un marchand.
 *   Pour la synthèse, seuls les totaux agrégés de la période sont transmis.
 * - Zéro dépendance lourde : appels REST légers directs via fetch().
 */

import { CATEGORIES, isCategoryId, type CategoryId } from './categories'
import {
  ASSISTANT_TOOL_DECLARATIONS,
  runAssistantTool,
  type AssistantToolContext,
} from './assistant-tools'
import type { AssistantArtifact, AssistantChatMessage } from './types'

export type AiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/** Délai maximal d'une requête Gemini. */
const REQUEST_TIMEOUT_MS = 25_000

/**
 * Modèles candidats par ordre de priorité :
 * 1. gemini-3.5-flash-lite : ultra-rapide, faible latence, moins sujet aux congestions
 * 2. gemini-3.8-flash : repli plus capable si le modèle allégé est saturé
 */
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash']

/** Vrai dans tout environnement moderne avec fetch disponible. */
export function isAiSupported(): boolean {
  return typeof globalThis.fetch === 'function'
}

/** Formate les erreurs de requête pour l'utilisateur final sans jargon développeur. */
function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return 'Délai d’attente dépassé (service temporairement trop lent).'
  }
  if (cause instanceof TypeError && /failed to fetch|network/i.test(cause.message)) {
    return 'Connexion internet inaccessible. Vérifiez votre réseau.'
  }
  if (cause instanceof Error) {
    if (/high demand|overloaded|surchargé|capacité/i.test(cause.message)) {
      return 'Le service est temporairement très sollicité. Veuillez réessayer dans quelques instants.'
    }
    return cause.message
  }
  return 'Le service d’assistance est momentanément indisponible.'
}

interface GeminiPayload {
  system_instruction?: {
    parts: { text: string }[]
  }
  contents: GeminiContent[]
  tools?: { functionDeclarations: readonly unknown[] }[]
  generationConfig?: {
    temperature?: number
    responseMimeType?: string
  }
}

interface GeminiFunctionCall {
  name?: string
  args?: Record<string, unknown>
  id?: string
}

interface GeminiPart {
  text?: string
  /** Part de réflexion interne : conservée dans l'historique, jamais affichée. */
  thought?: boolean
  thoughtSignature?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: {
    name: string
    id?: string
    response: Record<string, unknown>
  }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: GeminiPart[]
    }
    finishReason?: string
  }[]
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

async function tryModelRequest(
  model: string,
  apiKey: string,
  payload: GeminiPayload,
): Promise<
  | { ok: true; text: string; parts: GeminiPart[] }
  | { ok: false; status: number; message: string; retryable: boolean }
> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    let message = `Erreur (${response.status})`
    try {
      const errJson = (await response.json()) as GeminiResponse
      if (errJson.error?.message) {
        message = errJson.error.message
      }
    } catch {
      // Ignorer l'erreur de parsing
    }

    if (response.status === 400 || response.status === 403) {
      return { ok: false, status: response.status, message: 'Clé API invalide ou non autorisée.', retryable: false }
    }

    const isDemandError = response.status === 429 || response.status === 503 || /high demand|quota|capacity|unavailable/i.test(message)
    return {
      ok: false,
      status: response.status,
      message: isDemandError ? 'Service temporairement très sollicité.' : message,
      retryable: isDemandError || response.status >= 500,
    }
  }

  const data = (await response.json()) as GeminiResponse
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .filter((part) => !part.functionCall && !part.functionResponse)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
  if (!text.trim() && !parts.some((part) => part.functionCall)) {
    return { ok: false, status: 200, message: 'Réponse vide reçue.', retryable: false }
  }
  return { ok: true, text, parts }
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<string> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    throw new Error('Clé API non configurée.')
  }

  const payload: GeminiPayload = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  }

  let lastError = 'Service indisponible.'

  for (const model of GEMINI_MODELS) {
    try {
      const result = await tryModelRequest(model, trimmedKey, payload)
      if (result.ok) {
        return result.text
      }
      lastError = result.message
      // Si la clé est mauvaise, pas la peine de boucler sur les autres modèles
      if (!result.retryable) {
        throw new Error(result.message)
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'Clé API invalide ou non autorisée.') {
        throw cause
      }
      lastError = cause instanceof Error ? cause.message : 'Erreur de connexion'
    }
  }

  throw new Error(lastError)
}

/**
 * Valide une clé API Gemini en envoyant un ping minimal.
 */
export async function testGeminiApiKey(apiKey: string): Promise<AiResult<null>> {
  try {
    await callGemini(apiKey, 'Tu es un vérificateur technique.', 'Réponds OK')
    return { ok: true, value: null }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

export const MERCHANT_SYSTEM = [
  'Tu aides à ranger un relevé bancaire français.',
  'À partir de libellés bancaires bruts, tu devines le nom commercial du marchand.',
  'Ignore les références, numéros de carte, villes et mentions de paiement.',
  'Réponds obligatoirement avec un JSON au format : {"name": "Nom Du Marchand"}',
].join(' ')

export const ANALYSIS_SYSTEM = [
  'Tu es un analyste budgétaire francophone, factuel et concis.',
  'Tu commentes les chiffres fournis sans les inventer ni extrapoler.',
  'Réponds en français, en trois phrases maximum, sans titre ni liste.',
].join(' ')

/** Nettoie la réponse du modèle ; `null` si elle n'est pas exploitable. */
export function normalizeSuggestedName(value: string): string | null {
  let name = value.trim()
  const jsonStart = name.indexOf('{')
  const jsonEnd = name.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(name.slice(jsonStart, jsonEnd + 1)) as { name?: unknown }
      if (typeof parsed.name === 'string') name = parsed.name
    } catch {
      /* on retente sur le texte brut */
    }
  }

  const firstLine = name.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  name = firstLine
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '')
    .replace(/^(?:nom(?:\s+du\s+marchand)?|réponse)\s*:\s*/i, '')
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (name.length < 2 || name.length > 60) return null
  if (/\d{4,}/.test(name)) return null
  return name
}

/** Prompt envoyé au modèle pour proposer un nom de marchand. */
export function buildMerchantPrompt(labels: string[], currentName?: string): string {
  const samples = [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
    .slice(0, 12)
    .map((label) => `- ${label}`)

  return [
    'Libellés bancaires bruts de ce marchand :',
    ...samples,
    currentName ? `Nom actuel : ${currentName}` : '',
    'Propose un nom commercial court et lisible (30 caractères maximum). Format JSON attendu : {"name": "..."}',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Contexte chiffré de la période, sans donnée nominative. */
export interface AnalysisInput {
  label: string
  totals: { income: number; expenses: number; net: number; savingsRate: number | null }
  previous: { income: number; expenses: number; net: number }
  topCategories: { name: string; total: number; share: number }[]
  topMerchants: { name: string; total: number }[]
  recurringMonthly: number
}

function euro(value: number): string {
  return `${value.toFixed(2)} EUR`
}

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const { totals, previous } = input
  const categories = input.topCategories
    .slice(0, 5)
    .map((slice) => `- ${slice.name} : ${euro(slice.total)} (${Math.round(slice.share * 100)} %)`)
  const merchants = input.topMerchants
    .slice(0, 5)
    .map((merchant) => `- ${merchant.name} : ${euro(merchant.total)}`)

  return [
    `Période analysée : ${input.label}.`,
    `Entrées : ${euro(totals.income)}, dépenses : ${euro(totals.expenses)}, net : ${euro(
      totals.net,
    )}.`,
    `Période précédente : entrées ${euro(previous.income)}, dépenses ${euro(
      previous.expenses,
    )}, net ${euro(previous.net)}.`,
    totals.savingsRate === null
      ? 'Taux d’épargne non calculable (aucune entrée).'
      : `Taux d’épargne : ${Math.round(totals.savingsRate * 100)} %.`,
    input.recurringMonthly > 0
      ? `Charges récurrentes acceptées : ${euro(input.recurringMonthly)} par mois.`
      : '',
    categories.length > 0 ? `Principales catégories de dépenses :\n${categories.join('\n')}` : '',
    merchants.length > 0 ? `Principaux marchands :\n${merchants.join('\n')}` : '',
    'Rédige une synthèse utile : évolution marquante, poste à surveiller, piste concrète.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Suggestion de nom de marchand à partir d'un ou plusieurs libellés bruts. */
export async function suggestMerchantName(
  labels: string[],
  currentName?: string,
  apiKey?: string | null,
): Promise<AiResult<string>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (labels.length === 0) return { ok: false, error: 'Aucun libellé à analyser.' }

  try {
    const raw = await callGemini(
      apiKey,
      MERCHANT_SYSTEM,
      buildMerchantPrompt(labels, currentName),
      true,
    )
    const name = normalizeSuggestedName(raw)
    return name
      ? { ok: true, value: name }
      : { ok: false, error: 'Suggestion inexploitable, réessayez.' }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

/** Synthèse narrative de la période à partir des agrégats. */
export async function analyzePeriod(
  input: AnalysisInput,
  apiKey?: string | null,
): Promise<AiResult<string>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }

  try {
    const raw = await callGemini(apiKey, ANALYSIS_SYSTEM, buildAnalysisPrompt(input), false)
    const text = raw.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
    return text
      ? { ok: true, value: text }
      : { ok: false, error: 'Réponse vide, réessayez.' }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

export interface MerchantBatchItem {
  key: string
  labels: string[]
  currentName?: string
}

export interface MerchantBatchResult {
  key: string
  name: string
}

/** Extrait et valide le tableau JSON renvoyé par le modèle. */
export function parseMerchantBatchResponse(raw: string): MerchantBatchResult[] {
  const jsonStart = raw.indexOf('[')
  const jsonEnd = raw.lastIndexOf(']')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return []

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      key?: unknown
      name?: unknown
    }[]
    if (!Array.isArray(parsed)) return []

    const results: MerchantBatchResult[] = []
    for (const entry of parsed) {
      if (typeof entry.key !== 'string' || typeof entry.name !== 'string') continue
      const cleaned = normalizeSuggestedName(entry.name)
      if (cleaned) results.push({ key: entry.key, name: cleaned })
    }
    return results
  } catch {
    return []
  }
}

const BATCH_MERCHANT_SYSTEM = [
  'Tu es un assistant bancaire français expert en normalisation de marchands.',
  'À partir d’une liste d’entrées contenant chacune une clé et des libellés bancaires bruts,',
  'tu devines le nom commercial court et propre de chaque marchand (ex: "Carrefour", "Netflix", "SNCF").',
  'Ignore références, numéros de cartes, villes et détails superflus.',
  'Réponds obligatoirement avec un tableau JSON strict au format : [{"key": "...", "name": "..."}]',
].join(' ')

/**
 * Traite plusieurs marchands par paquets groupés (15 max par paquet)
 * pour minimiser les requêtes API et éviter tout quota.
 */
export async function batchSuggestMerchantNames(
  items: MerchantBatchItem[],
  apiKey?: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<AiResult<MerchantBatchResult[]>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (items.length === 0) return { ok: true, value: [] }

  const CHUNK_SIZE = 15
  const results: MerchantBatchResult[] = []

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE)
    const promptLines = [
      'Identifie le nom commercial de ces marchands :',
      ...chunk.map((item, idx) => {
        const samples = [...new Set(item.labels.map((l) => l.trim()).filter(Boolean))].slice(0, 4)
        return `[Marchand ${idx + 1}] Clé: "${item.key}"\nLibellés: ${samples.join(' | ')}${item.currentName ? `\nNom actuel: ${item.currentName}` : ''}`
      }),
      'Format JSON attendu : [{"key": "...", "name": "..."}]',
    ].join('\n\n')

    try {
      const raw = await callGemini(apiKey, BATCH_MERCHANT_SYSTEM, promptLines, true)
      results.push(...parseMerchantBatchResponse(raw))
    } catch (cause) {
      // Si un chunk échoue mais qu'on a déjà des résultats, on continue ou on signale
      if (results.length === 0 && i + CHUNK_SIZE >= items.length) {
        return { ok: false, error: describeError(cause) }
      }
    }
    onProgress?.(Math.min(items.length, i + CHUNK_SIZE), items.length)
  }

  return { ok: true, value: results }
}

export interface RecurringBatchItem {
  id: string
  merchantName: string
  amount: number
  intervalDays: number
}

export interface RecurringBatchResult {
  id: string
  decision: 'accepted' | 'refused'
  reason: string
}

/** Extrait et valide le tableau JSON de décisions renvoyé par le modèle. */
export function parseRecurringBatchResponse(raw: string): RecurringBatchResult[] {
  const jsonStart = raw.indexOf('[')
  const jsonEnd = raw.lastIndexOf(']')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return []

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      id?: unknown
      decision?: unknown
      reason?: unknown
    }[]
    if (!Array.isArray(parsed)) return []

    const results: RecurringBatchResult[] = []
    for (const entry of parsed) {
      if (
        typeof entry.id === 'string' &&
        (entry.decision === 'accepted' || entry.decision === 'refused')
      ) {
        results.push({
          id: entry.id,
          decision: entry.decision,
          reason: typeof entry.reason === 'string' ? entry.reason : '',
        })
      }
    }
    return results
  } catch {
    return []
  }
}

const BATCH_RECURRING_SYSTEM = [
  'Tu es un assistant bancaire spécialisé dans la détection des charges fixes et abonnements récurrents.',
  'Analyse chaque série de paiements pour déterminer s’il s’agit d’une charge fixe récurrente prévisible (loyer, électricité, abonnement internet, streaming, assurances, abonnements récurrents) -> "accepted",',
  'ou d’achats ponctuels répétés non fixes (courses variables, restaurants, shopping, retraits) -> "refused".',
  'Réponds obligatoirement avec un tableau JSON strict au format : [{"id": "...", "decision": "accepted"|"refused", "reason": "..."}]',
].join(' ')

/**
 * Analyse un ensemble de récurrences par requête groupée (20 max par lot).
 */
export async function batchAnalyzeRecurring(
  items: RecurringBatchItem[],
  apiKey?: string | null,
): Promise<AiResult<RecurringBatchResult[]>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (items.length === 0) return { ok: true, value: [] }

  const promptLines = [
    'Analyse ces opérations régulières et indique si ce sont des charges récurrentes/abonnements ("accepted") ou des achats ponctuels répétés ("refused") :',
    ...items.map(
      (item) =>
        `- ID: "${item.id}" | Marchand: "${item.merchantName}" | Montant: ${item.amount.toFixed(2)} EUR | Intervalle moyen: ~${item.intervalDays} jours`,
    ),
    'Format JSON attendu : [{"id": "...", "decision": "accepted"|"refused", "reason": "..."}]',
  ].join('\n')

  try {
    const raw = await callGemini(apiKey, BATCH_RECURRING_SYSTEM, promptLines, true)
    const results = parseRecurringBatchResponse(raw)
    return results.length > 0
      ? { ok: true, value: results }
      : { ok: false, error: 'Format de réponse invalide.' }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

/* -------------------------------------------------------------------------- */
/* Catégorisation automatique des marchands                                   */
/* -------------------------------------------------------------------------- */

export interface MerchantCategoryItem {
  key: string
  labels: string[]
  currentName?: string
}

export interface MerchantCategoryResult {
  key: string
  categoryId: CategoryId
  confidence: number
}

const CATEGORY_CATALOG = CATEGORIES.map(
  (category) => `${category.id} (${category.name} — ${category.description})`,
).join('\n- ')

/** Extrait et valide le tableau JSON de catégories renvoyé par le modèle. */
export function parseMerchantCategoryResponse(raw: string): MerchantCategoryResult[] {
  const jsonStart = raw.indexOf('[')
  const jsonEnd = raw.lastIndexOf(']')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return []

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      key?: unknown
      categoryId?: unknown
      confidence?: unknown
    }[]
    if (!Array.isArray(parsed)) return []

    const results: MerchantCategoryResult[] = []
    for (const entry of parsed) {
      if (typeof entry.key !== 'string' || typeof entry.categoryId !== 'string') continue
      if (!isCategoryId(entry.categoryId)) continue
      const confidence =
        typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
          ? Math.min(1, Math.max(0, entry.confidence))
          : 0.6
      results.push({ key: entry.key, categoryId: entry.categoryId, confidence })
    }
    return results
  } catch {
    return []
  }
}

const BATCH_CATEGORY_SYSTEM = [
  'Tu es un assistant bancaire français expert en catégorisation de dépenses.',
  'À partir de libellés bancaires bruts, tu choisis la catégorie la plus pertinente pour chaque marchand.',
  'Tu dois obligatoirement choisir un identifiant de catégorie parmi la liste fournie, sans en inventer.',
  'Si le libellé est ambigu (virement, chèque, espèce), choisis "transferts" ou "autres".',
  'Réponds uniquement avec un tableau JSON strict : [{"key": "...", "categoryId": "...", "confidence": 0.0}]',
].join(' ')

/**
 * Catégorise plusieurs marchands par paquets groupés (15 max par paquet).
 * Seuls les libellés bruts sont transmis, jamais les montants ni les soldes.
 */
export async function batchSuggestMerchantCategories(
  items: MerchantCategoryItem[],
  apiKey?: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<AiResult<MerchantCategoryResult[]>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (items.length === 0) return { ok: true, value: [] }

  const CHUNK_SIZE = 15
  const results: MerchantCategoryResult[] = []
  let failures = 0

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE)
    const promptLines = [
      'Catégories autorisées :',
      `- ${CATEGORY_CATALOG}`,
      '',
      'Marchands à classer :',
      ...chunk.map((item, idx) => {
        const samples = [...new Set(item.labels.map((label) => label.trim()).filter(Boolean))]
          .slice(0, 4)
          .join(' | ')
        return `[${idx + 1}] Clé: "${item.key}"\nLibellés: ${samples || '(inconnu)'}${
          item.currentName ? `\nNom actuel: ${item.currentName}` : ''
        }`
      }),
      '',
      'Format JSON attendu : [{"key": "...", "categoryId": "...", "confidence": 0.0}]',
    ].join('\n')

    try {
      const raw = await callGemini(apiKey, BATCH_CATEGORY_SYSTEM, promptLines, true)
      results.push(...parseMerchantCategoryResponse(raw))
    } catch {
      failures += 1
    }
    onProgress?.(Math.min(items.length, i + CHUNK_SIZE), items.length)
  }

  if (results.length === 0 && failures > 0) {
    return { ok: false, error: 'Catégorisation impossible, réessayez dans un instant.' }
  }
  return { ok: true, value: results }
}

/* -------------------------------------------------------------------------- */
/* Analyse et proposition de budgets                                          */
/* -------------------------------------------------------------------------- */

export interface BudgetCategoryStat {
  categoryId: string
  name: string
  /** Moyenne mensuelle observée sur la fenêtre analysée. */
  monthlyAverage: number
  /** Dépense du dernier mois complet. */
  lastMonth: number
  /** Nombre de mois réellement observés. */
  months: number
}

export interface BudgetProposal {
  categoryId: CategoryId
  monthlyLimit: number
  reason: string
}

/** Extrait et valide les plafonds proposés par le modèle. */
export function parseBudgetProposalResponse(raw: string): BudgetProposal[] {
  const jsonStart = raw.indexOf('[')
  const jsonEnd = raw.lastIndexOf(']')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return []

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      categoryId?: unknown
      monthlyLimit?: unknown
      reason?: unknown
    }[]
    if (!Array.isArray(parsed)) return []

    const proposals: BudgetProposal[] = []
    for (const entry of parsed) {
      if (typeof entry.categoryId !== 'string' || !isCategoryId(entry.categoryId)) continue
      if (typeof entry.monthlyLimit !== 'number' || !Number.isFinite(entry.monthlyLimit)) continue
      const monthlyLimit = Math.round(entry.monthlyLimit * 100) / 100
      if (monthlyLimit <= 0 || monthlyLimit > 1_000_000) continue
      proposals.push({
        categoryId: entry.categoryId,
        monthlyLimit,
        reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 160) : '',
      })
    }
    return proposals
  } catch {
    return []
  }
}

export function buildBudgetProposalsPrompt(
  stats: BudgetCategoryStat[],
  options: { months: number; totalMonthlyIncome: number | null; existing: string[] },
): string {
  const lines = stats
    .slice(0, 14)
    .map(
      (stat) =>
        `- ${stat.categoryId} (${stat.name}) : moyenne ${euro(stat.monthlyAverage)} / mois, dernier mois ${euro(
          stat.lastMonth,
        )} sur ${stat.months} mois observés`,
    )

  return [
    `Historique de dépenses sur ${options.months} mois, par catégorie :`,
    ...lines,
    options.totalMonthlyIncome !== null
      ? `Revenu moyen mensuel observé : ${euro(options.totalMonthlyIncome)}.`
      : 'Revenu moyen indisponible.',
    options.existing.length > 0
      ? `Budgets déjà définis (ne pas les redescendre brutalement) : ${options.existing.join(', ')}.`
      : 'Aucun budget défini pour l’instant.',
    '',
    'Propose un plafond mensuel réaliste par catégorie, arrondi à 5 EUR, qui laisse une marge de sécurité (5 à 10 %) tout en restant atteignable.',
    'Ignore les catégories dont la moyenne est inférieure à 5 EUR par mois.',
    'Format JSON attendu : [{"categoryId": "...", "monthlyLimit": 120.00, "reason": "..."}]',
  ].join('\n')
}

const BUDGET_PROPOSAL_SYSTEM = [
  'Tu es un conseiller budgétaire francophone rigoureux.',
  'Tu proposes des plafonds mensuels par catégorie à partir de moyennes agrégées.',
  'Tu ne surestimes jamais les montants et tu ne proposes jamais un plafond inférieur au dernier mois observé sans raison explicite.',
  'Réponds uniquement avec le tableau JSON demandé.',
].join(' ')

export async function proposeBudgets(
  stats: BudgetCategoryStat[],
  options: { months: number; totalMonthlyIncome: number | null; existing: string[] },
  apiKey?: string | null,
): Promise<AiResult<BudgetProposal[]>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (stats.length === 0) return { ok: false, error: 'Aucune dépense à analyser.' }

  try {
    const raw = await callGemini(
      apiKey,
      BUDGET_PROPOSAL_SYSTEM,
      buildBudgetProposalsPrompt(stats, options),
      true,
    )
    const proposals = parseBudgetProposalResponse(raw)
    return proposals.length > 0
      ? { ok: true, value: proposals }
      : { ok: false, error: 'Aucune proposition exploitable reçue.' }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

/* -------------------------------------------------------------------------- */
/* Assistant conversationnel (prompt libre)                                   */
/* -------------------------------------------------------------------------- */

export interface AssistantContext {
  periodLabel: string
  totals: { income: number; expenses: number; net: number; savingsRate: number | null }
  previous?: { income: number; expenses: number; net: number }
  categories: { name: string; total: number; share: number }[]
  merchants: { name: string; total: number }[]
  monthly: { month: string; income: number; expenses: number }[]
  recurring?: { label: string; amount: number; intervalDays: number; direction: 'expense' | 'income' }[]
  budgets?: { name: string; category: string; limit: number; spent: number }[]
  runway?: {
    balance: number
    averageDailyExpense: number
    daysLeft: number | null
    activeFunds: number
  }
  coverage?: { name: string; total: number }[]
}

export interface AssistantTurn {
  question: string
  answer: string
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function compactContext(input: AssistantContext): string {
  return JSON.stringify({
    periode: input.periodLabel,
    totaux: {
      entrees: round(input.totals.income),
      depenses: round(input.totals.expenses),
      net: round(input.totals.net),
      taux_epargne:
        input.totals.savingsRate === null ? null : round(input.totals.savingsRate * 100),
      periode_precedente: input.previous
        ? {
            entrees: round(input.previous.income),
            depenses: round(input.previous.expenses),
            net: round(input.previous.net),
          }
        : null,
    },
    categories: input.categories.slice(0, 8).map((category) => ({
      nom: category.name,
      total: round(category.total),
      part: round(category.share * 100),
    })),
    marchands: input.merchants.slice(0, 8).map((merchant) => ({
      nom: merchant.name,
      total: round(merchant.total),
    })),
    mensuel: input.monthly.slice(-12).map((month) => ({
      mois: month.month,
      entrees: round(month.income),
      depenses: round(month.expenses),
    })),
    recurrences: (input.recurring ?? []).slice(0, 10).map((item) => ({
      libelle: item.label,
      montant: round(item.amount),
      intervalle_jours: item.intervalDays,
      sens: item.direction === 'expense' ? 'depense' : 'entree',
    })),
    budgets: (input.budgets ?? []).map((budget) => ({
      nom: budget.name,
      categorie: budget.category,
      plafond: round(budget.limit),
      depense: round(budget.spent),
    })),
    tresorerie: input.runway
      ? {
          solde: round(input.runway.balance),
          depense_moyenne_jour: round(input.runway.averageDailyExpense),
          jours_restants: input.runway.daysLeft === null ? null : Math.round(input.runway.daysLeft),
          fonds_actifs: round(input.runway.activeFunds),
        }
      : null,
    couverture: (input.coverage ?? []).slice(0, 8).map((item) => ({
      nom: item.name,
      total: round(item.total),
    })),
  })
}

export function buildAssistantPrompt(
  context: AssistantContext,
  question: string,
  history: AssistantTurn[] = [],
): string {
  const previous = history
    .slice(-4)
    .map((turn) => `Question : ${turn.question}\nRéponse : ${turn.answer}`)
    .join('\n\n')

  return [
    'Contexte agrégé (aucune donnée nominative, aucun IBAN) :',
    compactContext(context),
    previous ? `Échanges précédents :\n${previous}` : '',
    `Question de l’utilisateur : ${question.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

const ASSISTANT_SYSTEM = [
  'Tu es un assistant budgétaire francophone intégré à une application locale.',
  'Tu réponds uniquement à partir du contexte agrégé fourni et tu n’inventes jamais de chiffre.',
  'Si l’information manque, dis-le clairement et propose quoi renseigner.',
  'Réponds en français, de façon concrète et concise : 120 mots maximum, listes courtes autorisées.',
  'Tu termines par une action concrète que l’utilisateur peut faire dans l’application.',
  'N’utilise ni emoji, ni titre Markdown, ni tableau.',
].join(' ')

/** Question répondue par l'assistant à partir des agrégats de la période. */
export async function askAssistant(
  context: AssistantContext,
  question: string,
  apiKey?: string | null,
  history: AssistantTurn[] = [],
): Promise<AiResult<string>> {
  if (!apiKey) return { ok: false, error: 'Clé API non configurée.' }
  if (!question.trim()) return { ok: false, error: 'Posez une question pour continuer.' }

  try {
    const raw = await callGemini(
      apiKey,
      ASSISTANT_SYSTEM,
      buildAssistantPrompt(context, question, history),
      false,
    )
    const text = raw
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/^---$/gm, '')
      .trim()
    return text
      ? { ok: true, value: text }
      : { ok: false, error: 'Réponse vide, reformulez votre question.' }
  } catch (cause) {
    return { ok: false, error: describeError(cause) }
  }
}

/** Question par défaut pour les diagnostics de budgets. */
export const BUDGET_ANALYSIS_QUESTION =
  'Analyse mes budgets : quelles catégories dérivent, lesquelles sont sous-utilisées et quels plafonds ajuster en priorité ?'

/** Question par défaut pour les diagnostics de trésorerie. */
export const COVERAGE_ANALYSIS_QUESTION =
  'Analyse ma trésorerie : combien de temps mon solde tient-il, quels revenus couvrent quelles dépenses et comment améliorer ma marge de sécurité ?'

/* -------------------------------------------------------------------------- */
/* Assistant à outils                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Modèles du chat, du plus capable au plus léger. Le chat privilégie la
 * qualité de raisonnement : il bascule sur un modèle plus léger uniquement
 * si le premier est saturé.
 */
const CHAT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite']

/** Nombre maximal d'allers-retours outil → modèle sur une même question. */
const MAX_TOOL_ROUNDS = 5
/** Plafond global d'appels d'outils par question. */
const MAX_TOOL_CALLS = 8
/** Messages d'historique renvoyés au modèle (les plus récents). */
const MAX_CHAT_HISTORY = 12
/** Artefacts visuels conservés dans une réponse. */
const MAX_ARTIFACTS = 5

/**
 * Outil de curation : une fois les recherches terminées, le modèle choisit
 * lui-même les cartes à afficher. Les appels d'outils restent invisibles pour
 * l'utilisateur ; seuls les artefacts désignés apparaissent dans la réponse.
 */
const PRESENT_ARTIFACTS_TOOL = {
  name: 'present_artifacts',
  description:
    'Dernière étape obligatoire quand une carte ou un graphique aide la réponse. Choisit parmi les artefacts disponibles (indices fournis avec chaque résultat d’outil) uniquement ceux qui comptent, 1 à 3 maximum. Les autres restent invisibles.',
  parameters: {
    type: 'OBJECT',
    properties: {
      indices: {
        type: 'ARRAY',
        items: { type: 'INTEGER' },
        description: 'Indices des artefacts à afficher, du plus important au moins important.',
      },
    },
    required: ['indices'],
  },
} as const

const ASSISTANT_TOOLS_SYSTEM = [
  'Tu es l’assistant budgétaire intégré à une application locale d’analyse de relevés bancaires.',
  'Tu disposes d’outils en lecture seule sur le coffre déchiffré : utilise-les avant d’affirmer un chiffre.',
  'Tes appels d’outils sont invisibles pour l’utilisateur : enchaîne les recherches nécessaires, puis ne garde que ce qui compte.',
  'Quand une carte ou un graphique aide la réponse, termine par present_artifacts en choisissant 1 à 3 indices parmi les artefacts disponibles. N’affiche ni les recherches intermédiaires ni les artefacts inutiles.',
  'Pour une opération précise (virement, prélèvement, achat), cherche-la avec search_transactions puis cite sa date et son montant : l’application affiche une carte cliquable.',
  'Appelle category_breakdown, monthly_series ou balance_history quand une comparaison visuelle aide à comprendre.',
  'N’invente jamais de montant, de marchand ou de date. Si une donnée manque, dis-le.',
  'Réponds en français, de façon concrète et concise (150 mots maximum). Markdown léger autorisé : listes et gras. Pas de tableau, pas d’emoji, pas de nom de modèle.',
  'Termine par une action concrète réalisable dans l’application.',
].join(' ')

/** Priorité de repli quand le modèle n'a pas désigné d'artefacts. */
const ARTIFACT_RELEVANCE: Record<AssistantArtifact['type'], number> = {
  transactions: 100,
  categories: 90,
  monthly: 80,
  balance: 70,
  merchants: 60,
  budgets: 50,
  recurring: 40,
  coverage: 30,
  allocations: 20,
}

/** Nombre d'artefacts affichés quand le modèle n'a rien choisi. */
const FALLBACK_ARTIFACTS = 3

export interface AssistantChatReply {
  text: string
  artifacts: AssistantArtifact[]
  /** Nombre d'outils réellement exécutés, pour l'indicateur de progression. */
  toolCalls: number
}

export interface AssistantChatInput {
  question: string
  /** Messages précédents de la conversation persistée. */
  history?: AssistantChatMessage[]
  context: AssistantToolContext
  apiKey?: string | null
}

function buildChatContents(
  history: AssistantChatMessage[],
  question: string,
): GeminiContent[] {
  const contents: GeminiContent[] = history
    .filter((message) => message.text.trim())
    .slice(-MAX_CHAT_HISTORY)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'model',
      parts: [{ text: message.text }],
    }))
  contents.push({ role: 'user', parts: [{ text: question.trim() }] })
  return contents
}

/** Nettoie la réponse finale sans toucher au markdown utile. */
export function cleanAssistantChatText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^---$/gm, '')
    .trim()
}

/** Fusionne les artefacts sans doublon et borne le nombre affiché. */
export function mergeAssistantArtifacts(artifacts: AssistantArtifact[]): AssistantArtifact[] {
  const seen = new Set<string>()
  const merged: AssistantArtifact[] = []
  for (const artifact of artifacts) {
    const key = JSON.stringify(artifact)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(artifact)
  }
  return merged.slice(-MAX_ARTIFACTS)
}

interface PooledArtifact {
  /** Indice 1-based communiqué au modèle. */
  index: number
  /** Tour d'outil qui a produit l'artefact (le plus récent est le plus pertinent). */
  round: number
  artifact: AssistantArtifact
}

function artifactCatalog(entries: PooledArtifact[]) {
  return entries.map((entry) => ({
    index: entry.index,
    type: entry.artifact.type,
    titre: entry.artifact.title,
  }))
}

/** Repli : un artefact par type, tours récents d'abord, puis pertinence. */
function selectFallbackArtifacts(pool: PooledArtifact[]): PooledArtifact[] {
  const ranked = [...pool].sort(
    (a, b) =>
      b.round - a.round ||
      ARTIFACT_RELEVANCE[b.artifact.type] - ARTIFACT_RELEVANCE[a.artifact.type] ||
      b.index - a.index,
  )
  const chosen: PooledArtifact[] = []
  const types = new Set<AssistantArtifact['type']>()
  for (const entry of ranked) {
    if (types.has(entry.artifact.type)) continue
    types.add(entry.artifact.type)
    chosen.push(entry)
    if (chosen.length >= FALLBACK_ARTIFACTS) break
  }
  return chosen.sort((a, b) => a.index - b.index)
}

function parseArtifactIndices(args: Record<string, unknown> | undefined): number[] {
  const raw = args?.indices
  if (!Array.isArray(raw)) return []
  const indices: number[] = []
  for (const value of raw) {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || indices.includes(parsed)) continue
    indices.push(parsed)
  }
  return indices.slice(0, MAX_ARTIFACTS)
}

interface ChatAttemptResult {
  ok: boolean
  reply?: AssistantChatReply
  message?: string
  retryable?: boolean
}

async function runChatAttempt(
  model: string,
  apiKey: string,
  history: AssistantChatMessage[],
  question: string,
  context: AssistantToolContext,
): Promise<ChatAttemptResult> {
  const contents = buildChatContents(history, question)
  const pool: PooledArtifact[] = []
  const poolKeys = new Map<string, number>()
  let selected: number[] = []
  let toolCalls = 0

  function poolArtifact(artifact: AssistantArtifact, round: number): number {
    const key = JSON.stringify(artifact)
    const existing = poolKeys.get(key)
    if (existing !== undefined) return existing
    const index = pool.length + 1
    pool.push({ index, round, artifact })
    poolKeys.set(key, index)
    return index
  }

  function finish(text: string): ChatAttemptResult {
    const indices = selected.length > 0 ? selected : selectFallbackArtifacts(pool).map((e) => e.index)
    const artifacts = indices
      .map((index) => pool.find((entry) => entry.index === index)?.artifact)
      .filter((artifact): artifact is AssistantArtifact => artifact !== undefined)
    if (!text && artifacts.length === 0) {
      return { ok: false, message: 'Réponse vide, reformulez votre question.', retryable: false }
    }
    return {
      ok: true,
      reply: {
        text: text || 'Voici les éléments correspondants.',
        artifacts: mergeAssistantArtifacts(artifacts),
        toolCalls,
      },
    }
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const result = await tryModelRequest(model, apiKey, {
      system_instruction: { parts: [{ text: ASSISTANT_TOOLS_SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: [...ASSISTANT_TOOL_DECLARATIONS, PRESENT_ARTIFACTS_TOOL] }],
      generationConfig: { temperature: 0.3 },
    })

    if (!result.ok) {
      return { ok: false, message: result.message, retryable: result.retryable }
    }

    const calls = result.parts.filter((part) => part.functionCall?.name)

    if (calls.length === 0) {
      return finish(cleanAssistantChatText(result.text))
    }

    // Au-delà du budget d'appels, on demande une synthèse finale sans outil.
    if (round === MAX_TOOL_ROUNDS || toolCalls + calls.length > MAX_TOOL_CALLS) {
      contents.push({ role: 'model', parts: result.parts })
      contents.push({
        role: 'user',
        parts: [
          {
            text: 'Synthétise maintenant les résultats déjà obtenus, sans appeler d’autre outil.',
          },
        ],
      })
      const final = await tryModelRequest(model, apiKey, {
        system_instruction: { parts: [{ text: ASSISTANT_TOOLS_SYSTEM }] },
        contents,
        generationConfig: { temperature: 0.3 },
      })
      if (!final.ok) {
        return { ok: false, message: final.message, retryable: final.retryable }
      }
      return finish(cleanAssistantChatText(final.text))
    }

    // Les parts sont renvoyées telles quelles : les thoughtSignature Gemini 3
    // doivent accompagner chaque functionCall pour le tour suivant.
    contents.push({ role: 'model', parts: result.parts })

    const responses: GeminiPart[] = []
    for (const part of calls) {
      const call = part.functionCall!
      const callId = call.id ? { id: call.id } : {}

      // Curation : le modèle désigne les artefacts à rendre visibles.
      if (call.name === PRESENT_ARTIFACTS_TOOL.name) {
        const indices = parseArtifactIndices(call.args)
        if (indices.length > 0) selected = indices
        responses.push({
          functionResponse: {
            name: call.name,
            ...callId,
            response: { result: { affiches: indices.length } },
          },
        })
        continue
      }

      toolCalls += 1
      let response: Record<string, unknown>
      try {
        const executed = runAssistantTool(call.name!, call.args ?? {}, context)
        const produced = executed.artifacts.map((artifact) => poolArtifact(artifact, round))
        response = {
          result: executed.summary,
          artefacts_disponibles: artifactCatalog(
            pool.filter((entry) => produced.includes(entry.index)),
          ),
        }
      } catch (cause) {
        response = {
          error: cause instanceof Error ? cause.message : 'Outil momentanément indisponible.',
        }
      }
      responses.push({
        functionResponse: {
          name: call.name!,
          ...callId,
          response,
        },
      })
    }
    contents.push({ role: 'user', parts: responses })
  }

  return { ok: false, message: 'Analyse trop longue, reformulez votre question.', retryable: false }
}

/**
 * Chat à outils : le modèle peut interroger le coffre (recherche d'opérations,
 * catégories, budgets, couverture…) et renvoyer des artefacts visuels.
 */
export async function askAssistantWithTools(
  input: AssistantChatInput,
): Promise<AiResult<AssistantChatReply>> {
  const key = input.apiKey?.trim()
  if (!key) return { ok: false, error: 'Clé API non configurée.' }
  if (!input.question.trim()) return { ok: false, error: 'Posez une question pour continuer.' }

  let lastError = 'Service indisponible.'

  for (const model of CHAT_MODELS) {
    try {
      const result = await runChatAttempt(
        model,
        key,
        input.history ?? [],
        input.question,
        input.context,
      )
      if (result.ok && result.reply) return { ok: true, value: result.reply }
      lastError = result.message ?? lastError
      if (!result.retryable) return { ok: false, error: lastError }
    } catch (cause) {
      lastError = describeError(cause)
      if (cause instanceof Error && /clé api/i.test(cause.message)) {
        return { ok: false, error: lastError }
      }
    }
  }

  return { ok: false, error: lastError }
}



