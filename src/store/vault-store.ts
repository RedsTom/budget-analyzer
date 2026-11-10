import { create } from 'zustand'
import {
  createVaultKey,
  decryptVault,
  emptyVault,
  encryptVault,
  unlockVaultKey,
  WrongPasswordError,
  type VaultKey,
} from '@/lib/crypto'
import type { ParsedTransaction } from '@/lib/csv'
import { clearEnvelope, hasVault, readEnvelope, writeEnvelope } from '@/lib/storage'
import { buildMerchantKey } from '@/lib/labels'
import { compareLedger, mergeTransactions } from '@/lib/dedupe'
import type {
  AliasEntry,
  AssistantChatMessage,
  BudgetPlan,
  Category,
  CustomAllocationMap,
  ImportSummary,
  ParseError,
  RecurringDecision,
  Transaction,
  VaultData,
} from '@/lib/types'

type Status = 'empty' | 'locked' | 'unlocked'

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
  lock: () => void
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
  setCustomAllocation: (expenseId: string, creditId: string) => Promise<void>
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
  reset: () => void
}

/**
 * La clé dérivée vit uniquement en mémoire, hors du store (pas d'inspection
 * accidentelle via les devtools). Verrouiller = l'oublier.
 */
let vaultKey: VaultKey | null = null
let createdAt: string | null = null

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

async function persist(
  get: () => VaultState,
  set: (partial: Partial<VaultState>) => void,
): Promise<void> {
  if (!vaultKey) return
  set({ saving: true, error: null })
  try {
    const envelope = await encryptVault(vaultKey, snapshot(get()))
    writeEnvelope(envelope)
  } catch (error) {
    set({ error: error instanceof Error ? error.message : 'Sauvegarde impossible' })
    throw error
  } finally {
    set({ saving: false })
  }
}

export const useVaultStore = create<VaultState>((set, get) => ({
  status: hasVault() ? 'locked' : 'empty',
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
      set({ status: 'empty' })
      throw new Error('Aucun coffre local')
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
      set({
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

  lock() {
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

  async setCustomAllocation(expenseId, creditId) {
    const customAllocations = { ...get().customAllocations, [expenseId]: creditId }
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
    const merchantKey = buildMerchantKey(input.rawLabel)
    const debit = input.amount < 0 ? input.amount : null
    const credit = input.amount > 0 ? input.amount : null
    const id = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`

    const existing = [...get().transactions]
    const newTx: Transaction = {
      id,
      date: input.date,
      valueDate: input.date,
      debit,
      credit,
      amount: input.amount,
      rawLabel: input.rawLabel,
      merchantKey,
      displayName: input.displayName?.trim() || undefined,
      categoryId: input.categoryId || undefined,
      note: input.note?.trim() || undefined,
      order: 0,
      sourceFile: 'manual',
      isManual: true,
      solde: 0,
    }

    const updated = [...existing, newTx].sort(compareLedger)
    const idx = updated.findIndex((t) => t.id === id)

    if (idx === 0) {
      // Solde avant la première opération, puis application du mouvement inséré.
      newTx.solde =
        updated.length > 1
          ? Math.round((updated[1].solde - updated[1].amount + input.amount) * 100) / 100
          : input.amount
    } else {
      newTx.solde = Math.round((updated[idx - 1].solde + input.amount) * 100) / 100
    }

    // Propager le décalage de solde à tous les mouvements postérieurs
    for (let k = idx + 1; k < updated.length; k++) {
      updated[k].solde = Math.round((updated[k].solde + input.amount) * 100) / 100
    }

    // Réindexer les ordres de séquence
    for (let i = 0; i < updated.length; i++) {
      updated[i].order = i + 1
    }

    set({ transactions: updated })
    await persist(get, set)
    return newTx
  },

  async updateManualTransaction(id, input) {
    const target = get().transactions.find((transaction) => transaction.id === id)
    if (!target) return

    // Supprimer l'ancienne opération puis réinsérer la nouvelle conserve
    // une chaîne de soldes continue, y compris en cas de changement de date.
    await get().deleteManualTransaction(id)
    await get().addManualTransaction(input)
  },

  async deleteManualTransaction(id) {
    const existing = [...get().transactions]
    const idx = existing.findIndex((t) => t.id === id)
    if (idx < 0) return

    const removedAmount = existing[idx].amount
    const remaining = existing.filter((t) => t.id !== id)

    // Propager le décalage inverse à tous les éléments suivants
    for (let k = idx; k < remaining.length; k++) {
      remaining[k].solde = Math.round((remaining[k].solde - removedAmount) * 100) / 100
    }

    for (let i = 0; i < remaining.length; i++) {
      remaining[i].order = i + 1
    }

    // Nettoyer aussi les affectations manuelles éventuelles liées à cette transaction
    const customAllocations = { ...get().customAllocations }
    let allocationChanged = false
    if (customAllocations[id]) {
      delete customAllocations[id]
      allocationChanged = true
    }
    for (const [expId, credId] of Object.entries(customAllocations)) {
      if (credId === id) {
        delete customAllocations[expId]
        allocationChanged = true
      }
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
    const envelope = readEnvelope()
    if (!envelope) throw new Error('Aucun coffre local')

    // Vérifie réellement l'ancien mot de passe (AES-GCM échoue au déchiffrement).
    const currentKey = await unlockVaultKey(currentPassword, envelope)
    await decryptVault(currentKey, envelope)

    const nextKey = await createVaultKey(nextPassword)
    const nextEnvelope = await encryptVault(nextKey, snapshot(get()))
    writeEnvelope(nextEnvelope)
    vaultKey = nextKey
  },

  reset() {
    clearEnvelope()
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
    })
  },
}))
