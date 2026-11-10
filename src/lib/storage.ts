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

export type VaultInspection =
  | { status: 'missing' }
  | { status: 'valid'; envelope: EncryptedEnvelope }
  | { status: 'corrupted'; raw: string }

/** Distingue l'absence d'un coffre d'un coffre présent mais illisible. */
export function inspectEnvelope(): VaultInspection {
  const storage = getStorage()
  if (!storage) return { status: 'missing' }

  let raw: string | null
  try {
    raw = storage.getItem(VAULT_STORAGE_KEY)
  } catch {
    return { status: 'missing' }
  }
  if (!raw) return { status: 'missing' }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isEncryptedEnvelope(parsed)) return { status: 'valid', envelope: parsed }
  } catch {
    // JSON invalide : on conserve la donnée brute pour l'écran de récupération.
  }
  return { status: 'corrupted', raw }
}

export function readEnvelope(): EncryptedEnvelope | null {
  const inspection = inspectEnvelope()
  return inspection.status === 'valid' ? inspection.envelope : null
}

export function getRawEnvelope(): string | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return storage.getItem(VAULT_STORAGE_KEY)
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
