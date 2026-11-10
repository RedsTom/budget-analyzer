import { describe, expect, it } from 'vitest'
import {
  createVaultKey,
  decryptVault,
  emptyVault,
  encryptVault,
  isEncryptedEnvelope,
  unlockVaultKey,
  WrongPasswordError,
} from './crypto'
import type { VaultData } from './types'

const ITERATIONS = 1_000

function sampleVault(): VaultData {
  const vault = emptyVault()
  vault.transactions.push({
    id: 'abc',
    date: '2026-08-25',
    valueDate: '2026-08-25',
    debit: null,
    credit: 40,
    amount: 40,
    rawLabel: 'VIR DE MLE FLORENCE BARILLET CH3V26237L006035',
    solde: 59.21,
    order: 0,
    sourceFile: 'test.csv',
    merchantKey: 'FLORENCE BARILLET',
  })
  vault.aliases['FLORENCE BARILLET'] = {
    merchantKey: 'FLORENCE BARILLET',
    displayName: 'Maman',
  }
  return vault
}

describe('coffre chiffré', () => {
  it('fait un aller-retour AES-GCM complet', async () => {
    const key = await createVaultKey('mot-de-passe-solide', ITERATIONS)
    const vault = sampleVault()
    const envelope = await encryptVault(key, vault)

    expect(isEncryptedEnvelope(envelope)).toBe(true)
    expect(envelope.kdf).toBe('PBKDF2-SHA256')
    expect(envelope.iterations).toBe(ITERATIONS)
    expect(JSON.stringify(envelope)).not.toContain('FLORENCE')

    const unlocked = await unlockVaultKey('mot-de-passe-solide', envelope)
    const decrypted = await decryptVault(unlocked, envelope)
    expect(decrypted).toEqual(vault)
  })

  it('utilise un IV neuf à chaque écriture', async () => {
    const key = await createVaultKey('mot-de-passe-solide', ITERATIONS)
    const first = await encryptVault(key, sampleVault())
    const second = await encryptVault(key, sampleVault())
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('rejette un mauvais mot de passe', async () => {
    const key = await createVaultKey('mot-de-passe-solide', ITERATIONS)
    const envelope = await encryptVault(key, sampleVault())
    const wrongKey = await unlockVaultKey('mauvais', envelope)

    await expect(decryptVault(wrongKey, envelope)).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })

  it('rejette un coffre altéré', async () => {
    const key = await createVaultKey('mot-de-passe-solide', ITERATIONS)
    const envelope = await encryptVault(key, sampleVault())
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA`,
    }

    await expect(decryptVault(key, tampered)).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })
})
