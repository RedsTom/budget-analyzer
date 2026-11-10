import { create } from 'zustand'
import type { AiFailure } from '@/lib/ai-errors'

interface AiNoticeState {
  failure: AiFailure | null
  retry: (() => void) | null
  show: (failure: AiFailure, retry?: () => void) => void
  close: () => void
}

/**
 * Popup unique pour les indisponibilités de l'IA. Le reste de l'application
 * n'est jamais bloqué : la popup explique simplement pourquoi l'action
 * distante n'a pas abouti.
 */
export const useAiNoticeStore = create<AiNoticeState>((set) => ({
  failure: null,
  retry: null,
  show(failure, retry) {
    set({ failure, retry: retry ?? null })
  },
  close() {
    set({ failure: null, retry: null })
  },
}))
