import { create } from 'zustand'
import type { CategoryId } from '@/lib/categories'
import type { DateRange, PeriodPreset } from '@/lib/period'
import { navigate } from '@/lib/router'

export type DirectionFilter = 'all' | 'expense' | 'income'

/** Entité affichée dans le panneau latéral droit, en colonne scindée. */
export type DetailTarget =
  | { kind: 'recurring'; id: string }
  | { kind: 'merchant'; merchantKey: string }
  | { kind: 'transaction'; id: string }

interface UiState {
  preset: PeriodPreset
  customRange: DateRange | null
  merchantFilter: string | null
  categoryFilter: CategoryId | null
  typeFilter: DirectionFilter
  search: string
  includeInactiveRecurring: boolean
  /** Feuille de saisie rapide, ouverte depuis la barre mobile ou la page. */
  quickEntryOpen: boolean
  quickEntryEditingId: string | null
  quickEntryInitialType: 'expense' | 'income'
  /** Cible retenue aussi pendant l'animation de fermeture. */
  detail: DetailTarget | null
  detailOpen: boolean
  setPreset: (preset: PeriodPreset) => void
  setCustomRange: (range: DateRange | null) => void
  setMerchantFilter: (merchantKey: string | null) => void
  setCategoryFilter: (categoryId: CategoryId | null) => void
  setTypeFilter: (typeFilter: DirectionFilter) => void
  setSearch: (search: string) => void
  setIncludeInactiveRecurring: (include: boolean) => void
  /** Ouvre la feuille de saisie, éventuellement sur une opération existante. */
  openQuickEntry: (options?: {
    id?: string
    type?: 'expense' | 'income'
  }) => void
  closeQuickEntry: () => void
  /** Ouvre directement une nouvelle dépense. */
  requestNewExpense: () => void
  resetFilters: () => void
  openDetail: (target: DetailTarget) => void
  closeDetail: () => void
  /** Purge la cible une fois l'animation de fermeture terminée. */
  clearDetail: () => void
  /** Ouvre les transactions sur une fenêtre précise (clic sur un graphique). */
  drillIntoRange: (range: DateRange) => void
  /** Ouvre les transactions d'un marchand. */
  focusMerchant: (merchantKey: string) => void
}

const INITIAL_FILTERS = {
  merchantFilter: null,
  categoryFilter: null,
  typeFilter: 'all' as DirectionFilter,
  search: '',
}

export const useUiStore = create<UiState>((set, get) => ({
  preset: '12m',
  customRange: null,
  ...INITIAL_FILTERS,
  includeInactiveRecurring: false,
  quickEntryOpen: false,
  quickEntryEditingId: null,
  quickEntryInitialType: 'expense',
  detail: null,
  detailOpen: false,

  setPreset(preset) {
    set({ preset, customRange: preset === 'custom' ? get().customRange : null })
  },

  setCustomRange(range) {
    set({ customRange: range, preset: range ? 'custom' : get().preset })
  },

  setMerchantFilter(merchantFilter) {
    set({ merchantFilter })
  },

  setCategoryFilter(categoryFilter) {
    set({ categoryFilter })
  },

  setTypeFilter(typeFilter) {
    set({ typeFilter })
  },

  setSearch(search) {
    set({ search })
  },

  setIncludeInactiveRecurring(includeInactiveRecurring) {
    set({ includeInactiveRecurring })
  },

  openQuickEntry(options) {
    set({
      quickEntryOpen: true,
      quickEntryEditingId: options?.id ?? null,
      quickEntryInitialType: options?.type ?? 'expense',
    })
  },

  closeQuickEntry() {
    set({ quickEntryOpen: false, quickEntryEditingId: null })
  },

  requestNewExpense() {
    get().openQuickEntry({ type: 'expense' })
  },

  resetFilters() {
    set({ ...INITIAL_FILTERS })
  },

  openDetail(detail) {
    set({ detail, detailOpen: true })
  },

  closeDetail() {
    if (!get().detailOpen) return
    set({ detailOpen: false })
  },

  clearDetail() {
    set({ detail: null })
  },

  drillIntoRange(range) {
    set({
      customRange: range,
      preset: 'custom',
      ...INITIAL_FILTERS,
      detailOpen: false,
    })
    navigate('transactions')
  },

  focusMerchant(merchantKey) {
    set({
      merchantFilter: merchantKey,
      categoryFilter: null,
      typeFilter: 'all',
      search: '',
      detailOpen: false,
    })
    navigate('transactions')
  },
}))
