import { afterEach, describe, expect, it } from 'vitest'
import {
  clearEnvelope,
  inspectEnvelope,
  readEnvelope,
  VAULT_STORAGE_KEY,
  writeEnvelope,
} from './storage'

function installStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
  return storage
}

const validEnvelope = JSON.stringify({
  v: 1,
  kdf: 'PBKDF2-SHA256',
  iterations: 310_000,
  salt: 'c2FsdA==',
  iv: 'aXY=',
  ciphertext: 'Y2lwaGVy',
})

afterEach(() => {
  clearEnvelope()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('storage', () => {
  it('distingue un coffre absent', () => {
    installStorage()
    expect(inspectEnvelope().status).toBe('missing')
    expect(readEnvelope()).toBeNull()
  })

  it('reconnaît une enveloppe valide', () => {
    installStorage({ [VAULT_STORAGE_KEY]: validEnvelope })
    const inspection = inspectEnvelope()
    expect(inspection.status).toBe('valid')
    expect(readEnvelope()?.iterations).toBe(310_000)
  })

  it('signale un JSON invalide sans l’écraser', () => {
    installStorage({ [VAULT_STORAGE_KEY]: '{not json' })
    const inspection = inspectEnvelope()
    expect(inspection.status).toBe('corrupted')
    if (inspection.status === 'corrupted') {
      expect(inspection.raw).toBe('{not json')
    }
    expect(readEnvelope()).toBeNull()
  })

  it('signale une enveloppe au schéma invalide', () => {
    installStorage({ [VAULT_STORAGE_KEY]: JSON.stringify({ v: 2 }) })
    expect(inspectEnvelope().status).toBe('corrupted')
  })

  it('écrit et efface une enveloppe', () => {
    installStorage()
    writeEnvelope(JSON.parse(validEnvelope))
    expect(inspectEnvelope().status).toBe('valid')
    clearEnvelope()
    expect(inspectEnvelope().status).toBe('missing')
  })
})
