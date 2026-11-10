import { isOnline } from './connectivity'

export type AiFailureCode =
  | 'offline'
  | 'timeout'
  | 'quota'
  | 'auth'
  | 'server'
  | 'invalid-response'
  | 'unknown'

export interface AiFailure {
  code: AiFailureCode
  message: string
  retryable: boolean
  status?: number
}

const MESSAGES: Record<AiFailureCode, string> = {
  offline: 'Connexion internet inaccessible. Vérifiez votre réseau.',
  timeout: 'Délai d’attente dépassé (service temporairement trop lent).',
  quota: 'Le service est temporairement très sollicité. Veuillez réessayer dans quelques instants.',
  auth: 'Clé API invalide ou non autorisée.',
  server: 'Le service d’assistance est momentanément indisponible.',
  'invalid-response': 'Réponse inexploitable reçue. Réessayez.',
  unknown: 'Le service d’assistance est momentanément indisponible.',
}

export function aiMessage(code: AiFailureCode): string {
  return MESSAGES[code]
}

export function failure(
  code: AiFailureCode,
  message = MESSAGES[code],
  options: { retryable?: boolean; status?: number } = {},
): AiFailure {
  return {
    code,
    message,
    retryable: options.retryable ?? (code === 'offline' || code === 'timeout' || code === 'quota' || code === 'server'),
    ...(options.status !== undefined ? { status: options.status } : {}),
  }
}

/** Convertit une erreur de `fetch` en échec stable et affichable. */
export function classifyAiError(cause: unknown, online = isOnline()): AiFailure {
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') {
      return failure('timeout')
    }
    if (
      cause instanceof TypeError ||
      /failed to fetch|load failed|networkerror|network request failed|network/i.test(cause.message)
    ) {
      return failure('offline', online ? 'Connexion interrompue. Vérifiez votre réseau.' : MESSAGES.offline)
    }
    if (/high demand|overloaded|surchargé|quota|capacity|unavailable|capacité/i.test(cause.message)) {
      return failure('quota')
    }
    if (/clé api|api key|invalid.*key|non autorisée/i.test(cause.message)) {
      return failure('auth', cause.message)
    }
    return failure('unknown', cause.message)
  }
  return failure('unknown')
}

/** Classification d'une réponse HTTP non 2xx. */
export function classifyAiStatus(status: number, message?: string): AiFailure {
  if (status === 400 || status === 401 || status === 403) {
    return failure(status === 401 || status === 403 ? 'auth' : 'unknown', message, {
      retryable: false,
      status,
    })
  }
  if (status === 429) {
    return failure('quota', message ?? MESSAGES.quota, { retryable: true, status })
  }
  if (status >= 500) {
    return failure('server', message ?? MESSAGES.server, { retryable: true, status })
  }
  return failure('unknown', message ?? `Erreur (${status})`, { status })
}

/**
 * Reconstruit un échec à partir d'un message déjà formaté (le chat à outils
 * manipule des messages et perd parfois l'erreur d'origine).
 */
export function aiFailureFromMessage(message: string): AiFailure {
  if (/réseau|connexion internet|load failed|failed to fetch/i.test(message)) {
    return failure('offline', message)
  }
  if (/délai|timeout|trop lent/i.test(message)) return failure('timeout', message)
  if (/sollicité|saturé|quota|demand/i.test(message)) return failure('quota', message)
  if (/clé api|non autorisée/i.test(message)) return failure('auth', message)
  return failure('unknown', message)
}

export function shouldNotifyAiFailure(value: AiFailure): boolean {
  return value.code === 'offline' || value.code === 'timeout' || value.code === 'quota' || value.code === 'auth'
}
