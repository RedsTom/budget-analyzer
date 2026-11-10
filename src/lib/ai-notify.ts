import { useAiNoticeStore } from '@/store/ai-notice-store'
import {
  aiFailureFromMessage,
  failure,
  shouldNotifyAiFailure,
  type AiFailure,
} from './ai-errors'
import { isOnline } from './connectivity'

/**
 * Affiche la popup globale pour les erreurs qui méritent une explication
 * (hors ligne, timeout, saturation, clé invalide). Les autres erreurs restent
 * des toasts ou des messages inline.
 */
export function notifyAiFailure(value: AiFailure, retry?: () => void): void {
  if (!shouldNotifyAiFailure(value)) return
  useAiNoticeStore.getState().show(value, retry)
}

export function notifyAiMessage(message: string, retry?: () => void): void {
  notifyAiFailure(aiFailureFromMessage(message), retry)
}

/** Préflight : évite un appel réseau inutile et affiche la popup tout de suite. */
export function guardAiOnline(retry?: () => void): boolean {
  if (isOnline()) return true
  useAiNoticeStore.getState().show(failure('offline'), retry ?? undefined)
  return false
}
