import { z } from 'zod'
import type { VaultData } from './types'

export const DEFAULT_ITERATIONS = 310_000

const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BITS = 256

/** WebCrypto exige des vues adossées à un `ArrayBuffer` (pas `SharedArrayBuffer`). */
type Bytes = Uint8Array<ArrayBuffer>

export interface EncryptedEnvelope {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export interface VaultKey {
  key: CryptoKey
  salt: Bytes
  iterations: number
}

const envelopeSchema = z.object({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().positive(),
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
})

const transactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  valueDate: z.string(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  amount: z.number(),
  rawLabel: z.string(),
  solde: z.number(),
  order: z.number().int(),
  sourceFile: z.string(),
  merchantKey: z.string(),
  displayName: z.string().optional(),
  categoryId: z.string().optional(),
  note: z.string().optional(),
  isManual: z.boolean().optional(),
})

const budgetPlanSchema = z.object({
  id: z.string(),
  categoryId: z.string().optional(),
  name: z.string(),
  monthlyLimit: z.number(),
  color: z.string().optional(),
})

const assistantArtifactSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('transactions'),
    title: z.string(),
    ids: z.array(z.string()),
  }),
  z.object({
    type: z.literal('merchants'),
    title: z.string(),
    items: z.array(
      z.object({
        merchantKey: z.string(),
        name: z.string(),
        total: z.number(),
        count: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal('categories'),
    title: z.string(),
    direction: z.enum(['expense', 'income']),
    total: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        total: z.number(),
        share: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal('monthly'),
    title: z.string(),
    points: z.array(
      z.object({
        month: z.string(),
        label: z.string(),
        income: z.number(),
        expenses: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal('balance'),
    title: z.string(),
    points: z.array(z.object({ date: z.string(), balance: z.number() })),
  }),
  z.object({
    type: z.literal('budgets'),
    title: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string(),
        limit: z.number(),
        spent: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal('recurring'),
    title: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        amount: z.number(),
        direction: z.enum(['expense', 'income']),
        frequency: z.string(),
        nextDate: z.string(),
        decision: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal('coverage'),
    title: z.string(),
    items: z.array(
      z.object({
        creditId: z.string(),
        label: z.string(),
        amount: z.number(),
        covered: z.number(),
        remaining: z.number(),
        coversUntil: z.string().nullable(),
      }),
    ),
  }),
  z.object({
    type: z.literal('allocations'),
    title: z.string(),
    items: z.array(
      z.object({
        expenseId: z.string(),
        expenseLabel: z.string(),
        expenseAmount: z.number(),
        creditId: z.string(),
        creditLabel: z.string(),
        creditAmount: z.number(),
      }),
    ),
  }),
])

const assistantChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.string(),
  artifacts: z.array(assistantArtifactSchema).optional(),
})

const vaultSchema = z.object({
  schemaVersion: z.literal(1),
  transactions: z.array(transactionSchema),
  aliases: z.record(
    z.string(),
    z.object({
      merchantKey: z.string(),
      displayName: z.string().optional(),
      categoryId: z.string().optional(),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().optional(),
    }),
  ),
  // Coffres créés avant les décisions : champ absent → aucune décision.
  recurringDecisions: z
    .record(z.string(), z.enum(['accepted', 'refused']))
    .default({}),
  // Budgets définis par l'utilisateur
  budgets: z.array(budgetPlanSchema).optional().default([]),
  // Affectations manuelles dépenses -> crédits
  customAllocations: z.record(z.string(), z.string()).optional().default({}),
  // IA : désactivée par défaut, y compris pour les coffres existants.
  aiEnabled: z.boolean().default(false),
  aiApiKey: z.string().optional(),
  // Conversation de l'assistant, effacée uniquement par « Nouveau chat ».
  assistantChat: z.array(assistantChatMessageSchema).optional().default([]),
  // Ancien champ de masquage : conservé pour la migration au déverrouillage.
  ignoredRecurring: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export class WrongPasswordError extends Error {
  constructor() {
    super('Mot de passe incorrect')
    this.name = 'WrongPasswordError'
  }
}

export class CorruptedVaultError extends Error {
  constructor() {
    super('Coffre illisible ou corrompu')
    this.name = 'CorruptedVaultError'
  }
}

export function emptyVault(): VaultData {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    transactions: [],
    aliases: {},
    categories: [],
    recurringDecisions: {},
    budgets: [],
    customAllocations: {},
    aiEnabled: false,
    assistantChat: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return envelopeSchema.safeParse(value).success
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Bytes {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function deriveKey(
  password: string,
  salt: Bytes,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function createVaultKey(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<VaultKey> {
  const salt: Bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return { key: await deriveKey(password, salt, iterations), salt, iterations }
}

export async function unlockVaultKey(
  password: string,
  envelope: EncryptedEnvelope,
): Promise<VaultKey> {
  const salt = fromBase64(envelope.salt)
  const key = await deriveKey(password, salt, envelope.iterations)
  return { key, salt, iterations: envelope.iterations }
}

export async function encryptVault(
  vaultKey: VaultKey,
  data: VaultData,
): Promise<EncryptedEnvelope> {
  // IV neuf à chaque écriture : indispensable pour AES-GCM.
  const iv: Bytes = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    vaultKey.key,
    plaintext,
  )

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: vaultKey.iterations,
    salt: toBase64(vaultKey.salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptVault(
  vaultKey: VaultKey,
  envelope: EncryptedEnvelope,
): Promise<VaultData> {
  const parsedEnvelope = envelopeSchema.safeParse(envelope)
  if (!parsedEnvelope.success) throw new CorruptedVaultError()

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parsedEnvelope.data.iv) },
      vaultKey.key,
      fromBase64(parsedEnvelope.data.ciphertext),
    )
  } catch {
    // AES-GCM ne distingue pas mauvais mot de passe et données altérées.
    throw new WrongPasswordError()
  }

  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(plaintext))
    return vaultSchema.parse(json)
  } catch {
    throw new CorruptedVaultError()
  }
}
