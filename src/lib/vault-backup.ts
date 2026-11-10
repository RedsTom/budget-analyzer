import { isEncryptedEnvelope } from './crypto'
import { removePasskey } from './passkey'
import { getRawEnvelope, writeEnvelope } from './storage'

/** Télécharge l'enveloppe chiffrée telle quelle, sans jamais la déchiffrer. */
export function downloadVaultBackup(): void {
  const raw = getRawEnvelope()
  if (!raw) throw new Error('Aucun coffre à exporter.')
  const blob = new Blob([raw], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  anchor.href = url
  anchor.download = `budget-analyzer-coffre-${date}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Restaure une enveloppe chiffrée. Le mot de passe reste nécessaire pour la
 * déverrouiller : la sauvegarde ne contient aucune clé.
 */
export async function restoreVaultBackup(file: File): Promise<void> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Ce fichier n’est pas un JSON valide.')
  }
  if (!isEncryptedEnvelope(parsed)) {
    throw new Error('Ce fichier ne contient pas un coffre Budget Analyzer valide.')
  }
  writeEnvelope(parsed)
  // La clé d'accès éventuelle scellait le mot de passe de l'ancien coffre.
  removePasskey()
}
