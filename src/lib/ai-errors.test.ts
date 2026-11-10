import { describe, expect, it } from 'vitest'
import {
  aiFailureFromMessage,
  classifyAiError,
  classifyAiStatus,
} from './ai-errors'

describe('classifyAiError', () => {
  it('reconnaît le timeout de AbortSignal.timeout', () => {
    const error = new Error('timeout')
    error.name = 'TimeoutError'
    expect(classifyAiError(error).code).toBe('timeout')
  })

  it('reconnaît AbortError', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(classifyAiError(error).code).toBe('timeout')
  })

  it('reconnaît le message réseau de Safari iOS', () => {
    expect(classifyAiError(new TypeError('Load failed')).code).toBe('offline')
  })

  it('reconnaît un échec fetch classique', () => {
    expect(classifyAiError(new TypeError('Failed to fetch')).code).toBe('offline')
  })

  it('reconnaît une saturation', () => {
    expect(classifyAiError(new Error('high demand')).code).toBe('quota')
  })
})

describe('classifyAiStatus', () => {
  it('classe 401 et 403 comme une clé invalide', () => {
    expect(classifyAiStatus(401).code).toBe('auth')
    expect(classifyAiStatus(403).code).toBe('auth')
    expect(classifyAiStatus(401).retryable).toBe(false)
  })

  it('classe 429 comme quota réessayable', () => {
    const failure = classifyAiStatus(429)
    expect(failure.code).toBe('quota')
    expect(failure.retryable).toBe(true)
  })

  it('classe 503 comme serveur réessayable', () => {
    const failure = classifyAiStatus(503)
    expect(failure.code).toBe('server')
    expect(failure.retryable).toBe(true)
  })
})

describe('aiFailureFromMessage', () => {
  it('reconstruit les cas hors ligne et timeout', () => {
    expect(aiFailureFromMessage('Connexion internet inaccessible.').code).toBe(
      'offline',
    )
    expect(aiFailureFromMessage('Délai d’attente dépassé.').code).toBe('timeout')
  })
})
