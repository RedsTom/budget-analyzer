export interface Transaction {
  /** SHA-256 de la ligne brute : identifiant stable et idempotent. */
  id: string
  /** Date d'opération, ISO `yyyy-mm-dd`. */
  date: string
  /** Date de valeur, ISO `yyyy-mm-dd`. */
  valueDate: string
  /** Montant brut de la colonne Débit (déjà négatif), ou null. */
  debit: number | null
  /** Montant brut de la colonne Crédit, ou null. */
  credit: number | null
  /** Montant signé utilisé pour les calculs : `debit ?? credit`. */
  amount: number
  /** Libellé bancaire d'origine, immuable. */
  rawLabel: string
  /** Solde courant de la banque après l'opération. */
  solde: number
  /** Ordre global, recalculé à chaque import (date puis ordre du fichier). */
  order: number
  sourceFile: string
  /** Clé de regroupement marchand, dérivée du libellé brut. */
  merchantKey: string
  /** Renommage ponctuel de cette transaction (prioritaire sur l'alias). */
  displayName?: string
  /** Catégorie ponctuelle de cette transaction. */
  categoryId?: string
  /** Note libre (saisie manuelle uniquement). */
  note?: string
  /** Indique si l'opération a été ajoutée manuellement par l'utilisateur. */
  isManual?: boolean
}

export interface AliasEntry {
  merchantKey: string
  displayName?: string
  categoryId?: string
}

export interface Category {
  id: string
  name: string
  color?: string
}

export interface BudgetPlan {
  id: string
  categoryId?: string
  name: string
  monthlyLimit: number
  color?: string
}

/** Affectation manuelle d'une dépense à un crédit spécifique (expenseId -> creditId). */
export type CustomAllocationMap = Record<string, string>

/** Décision explicite de l'utilisateur ; l'absence de décision = en attente. */
export type RecurringDecision = 'accepted' | 'refused'

/**
 * Élément visuel qu'un outil de l'assistant ajoute à sa réponse.
 * Les identifiants restent des références vivantes : les cartes sont
 * recalculées à l'affichage à partir du coffre courant.
 */
export type AssistantArtifact =
  | {
      type: 'transactions'
      title: string
      ids: string[]
    }
  | {
      type: 'merchants'
      title: string
      items: { merchantKey: string; name: string; total: number; count: number }[]
    }
  | {
      type: 'categories'
      title: string
      direction: 'expense' | 'income'
      total: number
      items: { id: string; name: string; color: string; total: number; share: number }[]
    }
  | {
      type: 'monthly'
      title: string
      points: { month: string; label: string; income: number; expenses: number }[]
    }
  | {
      type: 'balance'
      title: string
      points: { date: string; balance: number }[]
    }
  | {
      type: 'budgets'
      title: string
      items: { id: string; name: string; category: string; limit: number; spent: number }[]
    }
  | {
      type: 'recurring'
      title: string
      items: {
        id: string
        label: string
        amount: number
        direction: 'expense' | 'income'
        frequency: string
        nextDate: string
        decision: string
      }[]
    }
  | {
      type: 'coverage'
      title: string
      items: {
        creditId: string
        label: string
        amount: number
        covered: number
        remaining: number
        coversUntil: string | null
      }[]
    }
  | {
      type: 'allocations'
      title: string
      items: {
        expenseId: string
        expenseLabel: string
        expenseAmount: number
        creditId: string
        creditLabel: string
        creditAmount: number
      }[]
    }

/** Message de la conversation avec l'assistant, persisté dans le coffre. */
export interface AssistantChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  artifacts?: AssistantArtifact[]
}

export interface VaultData {
  schemaVersion: 1
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  categories: Category[]
  /** Décisions par identifiant de série (`merchantKey|in|out|date`). */
  recurringDecisions: Record<string, RecurringDecision>
  /** Budgets configurés par l'utilisateur. */
  budgets?: BudgetPlan[]
  /** Affectations manuelles dépenses -> crédits pour la couverture. */
  customAllocations?: CustomAllocationMap
  /** Préférence : autorise l'IA (désactivée par défaut, opt-in). */
  aiEnabled: boolean
  /** Clé API Google Gemini chiffrée dans le coffre (optionnelle). */
  aiApiKey?: string
  /** Conversation de l'assistant, conservée jusqu'à création d'un nouveau chat. */
  assistantChat?: AssistantChatMessage[]
  /** @deprecated Ancien masquage, migré en `refused` au déverrouillage. */
  ignoredRecurring?: string[]
  createdAt: string
  updatedAt: string
}

export interface ParseError {
  line: number
  message: string
}

export interface ImportSummary {
  added: number
  duplicates: number
  errors: ParseError[]
  sourceFile: string
}
