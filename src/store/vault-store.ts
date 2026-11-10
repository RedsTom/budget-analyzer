import { create } from 'zustand'
import {
  CorruptedVaultError,
  createVaultKey,
  decryptVault,
  emptyVault,
  encryptVault,
  unlockVaultKey,
  WrongPasswordError,
  type VaultKey,
} from '@/lib/crypto'
import type { ParsedTransaction } from '@/lib/csv'
import {
  clearEnvelope,
  inspectEnvelope,
  readEnvelope,
  writeEnvelope,
} from '@/lib/storage'
import { buildMerchantKey } from '@/lib/labels'
import { mergeTransactions } from '@/lib/dedupe'
import {
  insertIntoLedger,
  removeFromLedger,
  updateInLedger,
} from '@/lib/manual-ledger'
import { createWriteQueue, type WriteQueue } from '@/lib/persist-queue'
import { removePasskey } from '@/lib/passkey'
import {
  allocationParts,
  type AliasEntry,
  type AssistantChatMessage,
  type BudgetPlan,
  type Category,
  type CustomAllocationMap,
  type CustomAllocationPart,
  type ImportSummary,
  type ParseError,
  type RecurringDecision,
  type Transaction,
  type VaultData,
} from '@/lib/types'

type Status = 'empty' | 'locked' | 'unlocked' | 'corrupted'

export interface MerchantPatch {
  displayName?: string
  categoryId?: string
}

export interface ManualTransactionInput {
  date: string
  amount: number
  rawLabel: string
  categoryId?: string
  displayName?: string
  note?: string
}

/** Fichier déjà parsé, fourni à la création du coffre par l'onboarding. */
export interface SetupImport {
  rows: ParsedTransaction[]
  errors: ParseError[]
  sourceFile: string
}

interface VaultState {
  status: Status
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  categories: Category[]
  recurringDecisions: Record<string, RecurringDecision>
  budgets: BudgetPlan[]
  customAllocations: CustomAllocationMap
  aiEnabled: boolean
  aiApiKey: string | null
  /** Conversation de l'assistant, persistée dans le coffre chiffré. */
  assistantChat: AssistantChatMessage[]
  createdAt: string | null
  saving: boolean
  error: string | null
  lastImport: ImportSummary | null
  setup: (
    password: string,
    aiConfig?: { enabled: boolean; apiKey?: string },
    imports?: SetupImport[],
  ) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => Promise<void>
  /** Fusionne des lignes déjà parsées (onboarding ou import avec mappage). */
  importRows: (
    rows: ParsedTransaction[],
    sourceFile: string,
    errors?: ParseError[],
  ) => Promise<ImportSummary>
  renameMerchant: (merchantKey: string, displayName: string) => Promise<void>
  updateMerchant: (merchantKey: string, patch: MerchantPatch) => Promise<void>
  batchUpdateMerchants: (
    updates: { merchantKey: string; displayName?: string; categoryId?: string }[],
  ) => Promise<void>
  setRecurringDecision: (
    seriesId: string,
    decision: RecurringDecision | null,
  ) => Promise<void>
  batchSetRecurringDecisions: (
    decisions: Record<string, RecurringDecision>,
  ) => Promise<void>
  saveBudget: (budget: BudgetPlan) => Promise<void>
  /** Remplace la liste entière en une seule écriture chiffrée. */
  saveBudgets: (budgets: BudgetPlan[]) => Promise<void>
  deleteBudget: (budgetId: string) => Promise<void>
  setCustomAllocation: (
    expenseId: string,
    creditId: string,
    amount?: number,
  ) => Promise<void>
  /** Affecte une dépense à une ou plusieurs parts de revenus. */
  setCoverageAllocationParts: (
    expenseId: string,
    parts: CustomAllocationPart[],
  ) => Promise<void>
  deleteCustomAllocation: (expenseId: string) => Promise<void>
  clearCustomAllocations: () => Promise<void>
  addManualTransaction: (input: ManualTransactionInput) => Promise<Transaction>
  updateManualTransaction: (id: string, input: ManualTransactionInput) => Promise<void>
  deleteManualTransaction: (id: string) => Promise<void>
  setAiEnabled: (enabled: boolean) => Promise<void>
  setAiApiKey: (apiKey: string | null) => Promise<void>
  setAiConfig: (config: { enabled: boolean; apiKey?: string | null }) => Promise<void>
  /** Ajoute des messages à la conversation et la borne aux plus récents. */
  appendAssistantChat: (messages: AssistantChatMessage[]) => Promise<void>
  /** Efface la conversation (bouton « Nouveau chat »). */
  clearAssistantChat: () => Promise<void>
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  /** Vérifie un mot de passe sans modifier l'état du coffre. */
  verifyPassword: (password: string) => Promise<boolean>
  /** Relance une écriture après une erreur de quota ou de stockage. */
  retrySave: () => Promise<void>
  reset: () => void
}

/**
 * La clé dérivée vit uniquement en mémoire, hors du store (pas d'inspection
 * accidentelle via les devtools). Verrouiller = l'oublier.
 */
let vaultKey: VaultKey | null = null
let createdAt: string | null = null
let persistQueue: WriteQueue | null = null

function snapshot(state: VaultState): VaultData {
  return {
    schemaVersion: 1,
    transactions: state.transactions,
    aliases: state.aliases,
    categories: state.categories,
    recurringDecisions: state.recurringDecisions,
    budgets: state.budgets,
    customAllocations: state.customAllocations,
    aiEnabled: state.aiEnabled,
    aiApiKey: state.aiApiKey ?? undefined,
    assistantChat: state.assistantChat,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function buildManualTransaction(
  input: ManualTransactionInput,
  id: string,
): Transaction {
  const merchantKey = buildMerchantKey(input.rawLabel)
  return {
    id,
    date: input.date,
    valueDate: input.date,
    debit: input.amount < 0 ? input.amount : null,
    credit: input.amount > 0 ? input.amount : null,
    amount: input.amount,
    rawLabel: input.rawLabel,
    merchantKey,
    displayName: input.displayName?.trim() || undefined,
    categoryId: input.categoryId || undefined,
    note: input.note?.trim() || undefined,
    // Une saisie manuelle du même jour passe après les opérations bancaires
    // déjà présentes : elle ne doit pas se retrouver avant les crédits du jour
    // et échapper à leur couverture manuelle.
    order: Number.MAX_SAFE_INTEGER,
    sourceFile: 'manual',
    isManual: true,
    solde: 0,
  }
}

async function persist(
  _get: () => VaultState,
  set: (partial: Partial<VaultState>) => void,
): Promise<void> {
  if (!vaultKey || !persistQueue) return
  set({ saving: true, error: null })
  try {
    await persistQueue.schedule()
  } catch (error) {
    set({ error: error instanceof Error ? error.message : 'Sauvegarde impossible' })
    throw error
  } finally {
    if (persistQueue.isIdle()) set({ saving: false })
  }
}

const initialInspection = inspectEnvelope()

export const useVaultStore = create<VaultState>((set, get) => ({
  status:
    initialInspection.status === 'valid'
      ? 'locked'
      : initialInspection.status === 'corrupted'
        ? 'corrupted'
        : 'empty',
  transactions: [],
  aliases: {},
  categories: [],
  recurringDecisions: {},
  budgets: [],
  customAllocations: {},
  aiEnabled: false,
  aiApiKey: null,
  assistantChat: [],
  createdAt: null,
  saving: false,
  error: null,
  lastImport: null,

  async setup(password, aiConfig, imports = []) {
    const key = await createVaultKey(password)
    const data = emptyVault()
    if (aiConfig) {
      data.aiEnabled = aiConfig.enabled
      data.aiApiKey = aiConfig.apiKey
    }

    // Les fichiers fournis par l'onboarding sont fusionnés avant la première
    // écriture chiffrée : une seule enveloppe, dédoublonnage multi-fichiers.
    let transactions: Transaction[] = []
    let lastImport: ImportSummary | null = null
    for (const item of imports) {
      const merged = await mergeTransactions(transactions, item.rows, item.sourceFile)
      transactions = merged.transactions
      lastImport = {
        added: merged.added,
        duplicates: merged.duplicates,
        errors: item.errors,
        sourceFile: item.sourceFile,
      }
    }
    data.transactions = transactions

    const envelope = await encryptVault(key, data)
    writeEnvelope(envelope)

    vaultKey = key
    createdAt = data.createdAt
    set({
      status: 'unlocked',
      transactions,
      aliases: {},
      categories: [],
      recurringDecisions: {},
      budgets: [],
      customAllocations: {},
      aiEnabled: data.aiEnabled,
      aiApiKey: data.aiApiKey ?? null,
      assistantChat: data.assistantChat ?? [],
      createdAt: data.createdAt,
      lastImport,
      error: null,
    })
  },

  async unlock(password) {
    const envelope = readEnvelope()
    if (!envelope) {
      const inspection = inspectEnvelope()
      const corrupted = inspection.status === 'corrupted'
      set({ status: corrupted ? 'corrupted' : 'empty' })
      throw new Error(corrupted ? 'Coffre illisible ou corrompu' : 'Aucun coffre local')
    }

    try {
      const key = await unlockVaultKey(password, envelope)
      const data = await decryptVault(key, envelope)
      vaultKey = key
      createdAt = data.createdAt
      // Migration douce : les anciennes séries masquées deviennent refusées.
      const recurringDecisions: Record<string, RecurringDecision> = {
        ...data.recurringDecisions,
      }
      for (const seriesId of data.ignoredRecurring ?? []) {
        if (!recurringDecisions[seriesId]) {
          recurringDecisions[seriesId] = 'refused'
        }
      }
      set({
        status: 'unlocked',
        transactions: data.transactions,
        aliases: data.aliases,
        categories: data.categories,
        recurringDecisions,
        budgets: data.budgets ?? [],
        customAllocations: data.customAllocations ?? {},
        aiEnabled: data.aiEnabled,
        aiApiKey: data.aiApiKey ?? null,
        assistantChat: data.assistantChat ?? [],
        createdAt: data.createdAt,
        error: null,
      })
    } catch (error) {
      const corrupted = error instanceof CorruptedVaultError
      set({
        status: corrupted ? 'corrupted' : 'locked',
        error:
          error instanceof WrongPasswordError
            ? 'Mot de passe incorrect'
            : error instanceof Error
              ? error.message
              : 'Déverrouillage impossible',
      })
      throw error
    }
  },

  async lock() {
    // Les mutations en attente doivent être écrites avant d'oublier la clé.
    try {
      await flushVaultWrites()
    } catch {
      // On verrouille quand même : l'erreur de sauvegarde reste visible.
    }
    vaultKey = null
    createdAt = null
    set({
      status: 'locked',
      transactions: [],
      aliases: {},
      categories: [],
      recurringDecisions: {},
      budgets: [],
      customAllocations: {},
      aiEnabled: false,
      aiApiKey: null,
      assistantChat: [],
      createdAt: null,
      lastImport: null,
      saving: false,
      error: null,
    })
  },

  async importRows(rows, sourceFile, errors = []) {
    const merged = await mergeTransactions(get().transactions, rows, sourceFile)
    const summary: ImportSummary = {
      added: merged.added,
      duplicates: merged.duplicates,
      errors,
      sourceFile,
    }
    set({ transactions: merged.transactions, lastImport: summary })
    await persist(get, set)
    return summary
  },

  async renameMerchant(merchantKey, displayName) {
    await get().updateMerchant(merchantKey, { displayName })
  },

  async updateMerchant(merchantKey, patch) {
    const current: AliasEntry = get().aliases[merchantKey] ?? { merchantKey }
    const next: AliasEntry = { ...current, merchantKey }

    if (patch.displayName !== undefined) {
      const trimmed = patch.displayName.trim()
      if (trimmed) next.displayName = trimmed
      else delete next.displayName
    }
    if (patch.categoryId !== undefined) {
      if (patch.categoryId) next.categoryId = patch.categoryId
      else delete next.categoryId
    }

    const aliases = { ...get().aliases }
    if (!next.displayName && !next.categoryId) delete aliases[merchantKey]
    else aliases[merchantKey] = next

    set({ aliases })
    await persist(get, set)
  },

  async batchUpdateMerchants(updates) {
    const aliases = { ...get().aliases }
    for (const update of updates) {
      const current: AliasEntry = aliases[update.merchantKey] ?? {
        merchantKey: update.merchantKey,
      }
      const next: AliasEntry = { ...current, merchantKey: update.merchantKey }
      if (update.displayName !== undefined) {
        const trimmed = update.displayName.trim()
        if (trimmed) next.displayName = trimmed
        else delete next.displayName
      }
      if (update.categoryId !== undefined) {
        if (update.categoryId) next.categoryId = update.categoryId
        else delete next.categoryId
      }
      if (!next.displayName && !next.categoryId) {
        delete aliases[update.merchantKey]
      } else {
        aliases[update.merchantKey] = next
      }
    }
    set({ aliases })
    await persist(get, set)
  },

  async setRecurringDecision(seriesId, decision) {
    const recurringDecisions = { ...get().recurringDecisions }
    if (decision) recurringDecisions[seriesId] = decision
    else delete recurringDecisions[seriesId]
    set({ recurringDecisions })
    await persist(get, set)
  },

  async batchSetRecurringDecisions(decisions) {
    const recurringDecisions = { ...get().recurringDecisions, ...decisions }
    set({ recurringDecisions })
    await persist(get, set)
  },

  async saveBudget(budget) {
    const current = get().budgets
    const idx = current.findIndex((b) => b.id === budget.id)
    const next = idx >= 0 ? current.map((b, i) => (i === idx ? budget : b)) : [...current, budget]
    set({ budgets: next })
    await persist(get, set)
  },

  async saveBudgets(budgets) {
    set({ budgets })
    await persist(get, set)
  },

  async deleteBudget(budgetId) {
    set({ budgets: get().budgets.filter((b) => b.id !== budgetId) })
    await persist(get, set)
  },

  async setCustomAllocation(expenseId, creditId, amount) {
    const value =
      amount === undefined
        ? creditId
        : {
            creditId,
            amount: Math.max(0, Math.round(amount * 100) / 100),
          }
    const customAllocations = { ...get().customAllocations, [expenseId]: value }
    set({ customAllocations })
    await persist(get, set)
  },

  async setCoverageAllocationParts(expenseId, parts) {
    const expense = get().transactions.find(
      (transaction) => transaction.id === expenseId,
    )
    if (!expense || expense.amount >= 0) return
    const normalized = allocationParts(parts, -expense.amount)
    const customAllocations = { ...get().customAllocations }
    if (normalized.length === 0) delete customAllocations[expenseId]
    else customAllocations[expenseId] = normalized
    set({ customAllocations })
    await persist(get, set)
  },

  async deleteCustomAllocation(expenseId) {
    const customAllocations = { ...get().customAllocations }
    delete customAllocations[expenseId]
    set({ customAllocations })
    await persist(get, set)
  },

  async clearCustomAllocations() {
    set({ customAllocations: {} })
    await persist(get, set)
  },

  async addManualTransaction(input) {
    const id = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    const newTx = buildManualTransaction(input, id)
    const updated = insertIntoLedger(get().transactions, newTx)
    set({ transactions: updated })
    await persist(get, set)
    // `insertIntoLedger` clone la transaction pour calculer son solde :
    // on renvoie l'objet réellement stocké.
    return updated.find((transaction) => transaction.id === id) ?? newTx
  },

  async updateManualTransaction(id, input) {
    const target = get().transactions.find((transaction) => transaction.id === id)
    if (!target) return

    // Une seule mutation logique : suppression et réinsertion calculées en
    // mémoire, puis une seule écriture chiffrée. L'identifiant est conservé
    // pour ne pas perdre les affectations de couverture liées.
    const next = buildManualTransaction(input, id)
    const updated = updateInLedger(get().transactions, next)
    set({ transactions: updated })
    await persist(get, set)
  },

  async deleteManualTransaction(id) {
    const target = get().transactions.find((transaction) => transaction.id === id)
    if (!target) return

    const remaining = removeFromLedger(get().transactions, id)

    // Nettoyer aussi les affectations manuelles éventuelles liées à cette transaction
    const customAllocations = { ...get().customAllocations }
    let allocationChanged = false
    if (customAllocations[id]) {
      delete customAllocations[id]
      allocationChanged = true
    }
    for (const [expId, value] of Object.entries(customAllocations)) {
      const expense = get().transactions.find((transaction) => transaction.id === expId)
      if (!expense || expense.amount >= 0) {
        delete customAllocations[expId]
        allocationChanged = true
        continue
      }
      const parts = allocationParts(value, -expense.amount)
      const nextParts = parts.filter((part) => part.creditId !== id)
      if (nextParts.length === parts.length) continue
      allocationChanged = true
      if (nextParts.length === 0) delete customAllocations[expId]
      else customAllocations[expId] = nextParts
    }

    set({
      transactions: remaining,
      ...(allocationChanged ? { customAllocations } : {}),
    })
    await persist(get, set)
  },

  async setAiEnabled(enabled) {
    set({ aiEnabled: enabled })
    await persist(get, set)
  },

  async setAiApiKey(apiKey) {
    set({ aiApiKey: apiKey ? apiKey.trim() : null })
    await persist(get, set)
  },

  async setAiConfig(config) {
    set({
      aiEnabled: config.enabled,
      aiApiKey: config.apiKey ? config.apiKey.trim() : null,
    })
    await persist(get, set)
  },

  async appendAssistantChat(messages) {
    if (messages.length === 0) return
    const assistantChat = [...get().assistantChat, ...messages].slice(-60)
    set({ assistantChat })
    await persist(get, set)
  },

  async clearAssistantChat() {
    set({ assistantChat: [] })
    await persist(get, set)
  },

  async changePassword(currentPassword, nextPassword) {
    // Les écritures en attente doivent être incluses dans la nouvelle
    // enveloppe, sinon le changement de mot de passe peut les perdre.
    await flushVaultWrites()
    const envelope = readEnvelope()
    if (!envelope) throw new Error('Aucun coffre local')

    // Vérifie réellement l'ancien mot de passe (AES-GCM échoue au déchiffrement).
    const currentKey = await unlockVaultKey(currentPassword, envelope)
    await decryptVault(currentKey, envelope)

    const nextKey = await createVaultKey(nextPassword)
    const nextEnvelope = await encryptVault(nextKey, snapshot(get()))
    writeEnvelope(nextEnvelope)
    vaultKey = nextKey
    // La clé d'accès scelle l'ancien mot de passe : elle devient invalide.
    removePasskey()
  },

  async verifyPassword(password) {
    const envelope = readEnvelope()
    if (!envelope) return false
    try {
      const key = await unlockVaultKey(password, envelope)
      await decryptVault(key, envelope)
      return true
    } catch {
      return false
    }
  },

  async retrySave() {
    await persist(get, set)
  },

  reset() {
    clearEnvelope()
    removePasskey()
    vaultKey = null
    createdAt = null
    set({
      status: 'empty',
      transactions: [],
      aliases: {},
      categories: [],
      recurringDecisions: {},
      budgets: [],
      customAllocations: {},
      aiEnabled: false,
      aiApiKey: null,
      assistantChat: [],
      createdAt: null,
      lastImport: null,
      error: null,
      saving: false,
    })
  },
}))

persistQueue = createWriteQueue(async () => {
  if (!vaultKey) return
  const envelope = await encryptVault(vaultKey, snapshot(useVaultStore.getState()))
  writeEnvelope(envelope)
})

/** Attend que toutes les mutations en attente soient réellement écrites. */
export async function flushVaultWrites(): Promise<void> {
  await persistQueue?.flush()
}
