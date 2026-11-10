import { isEncryptedEnvelope, type EncryptedEnvelope } from './crypto'

/** Clé unique et versionnée : un seul coffre, tout en local. */
export const VAULT_STORAGE_KEY = 'budget.vault.v1'

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readEnvelope(): EncryptedEnvelope | null {
  const storage = getStorage()
  if (!storage) return null

  const raw = storage.getItem(VAULT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    return isEncryptedEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeEnvelope(envelope: EncryptedEnvelope): void {
  getStorage()?.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope))
}

export function clearEnvelope(): void {
  getStorage()?.removeItem(VAULT_STORAGE_KEY)
}

export function hasVault(): boolean {
  return readEnvelope() !== null
}
