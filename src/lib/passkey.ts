const STORAGE_KEY = 'budget.passkey.v1'
const RP_NAME = 'Budget Analyzer'
const PRF_INFO = new TextEncoder().encode('budget-analyzer/passkey-wrap/v1')

export type PasskeyErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'no-prf'
  | 'failed'
  | 'no-record'

export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode

  constructor(code: PasskeyErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PasskeyError'
    this.code = code
  }
}

export interface PasskeyInfo {
  createdAt: string
  label: string
}

interface PasskeyRecord extends PasskeyInfo {
  v: 1
  credentialId: string
  prfSalt: string
  iv: string
  ciphertext: string
}

interface PrfOutputs {
  prf?: {
    enabled?: boolean
    results?: { first?: ArrayBuffer }
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

function readRecord(): PasskeyRecord | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PasskeyRecord>
    if (
      parsed.v !== 1 ||
      typeof parsed.credentialId !== 'string' ||
      typeof parsed.prfSalt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.ciphertext !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.label !== 'string'
    ) {
      return null
    }
    return parsed as PasskeyRecord
  } catch {
    return null
  }
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function' &&
    Boolean(window.location.hostname)
  )
}

export function hasPasskey(): boolean {
  return readRecord() !== null
}

export function getPasskeyInfo(): PasskeyInfo | null {
  const record = readRecord()
  return record ? { createdAt: record.createdAt, label: record.label } : null
}

export function removePasskey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à supprimer si le stockage est indisponible.
  }
}

function classifyWebAuthnError(cause: unknown): PasskeyError {
  if (cause instanceof PasskeyError) return cause
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return new PasskeyError('cancelled', 'Opération annulée ou expirée.')
  }
  if (
    cause instanceof DOMException &&
    (cause.name === 'NotSupportedError' || cause.name === 'SecurityError')
  ) {
    return new PasskeyError(
      'unsupported',
      'Les clés d’accès nécessitent HTTPS et un navigateur compatible.',
    )
  }
  return new PasskeyError(
    'failed',
    cause instanceof Error ? cause.message : 'La clé d’accès n’a pas pu être utilisée.',
  )
}

async function requestPrf(
  credentialId: BufferSource,
  prfSalt: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: window.location.hostname,
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as PublicKeyCredentialRequestOptions['extensions'],
    },
  })) as PublicKeyCredential | null

  const outputs = assertion?.getClientExtensionResults() as PrfOutputs | undefined
  const first = outputs?.prf?.results?.first
  if (!first) {
    throw new PasskeyError(
      'no-prf',
      'Cette clé d’accès ne fournit pas le secret chiffré nécessaire. Essayez un autre gestionnaire de clés ou utilisez le mot de passe.',
    )
  }
  return first
}

async function deriveWrappingKey(
  prfOutput: ArrayBuffer,
  prfSalt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: prfSalt,
      info: PRF_INFO,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptPassword(
  password: string,
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(password),
  )
  return {
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

async function decryptPassword(
  record: PasskeyRecord,
  key: CryptoKey,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(record.iv) },
    key,
    fromBase64Url(record.ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

/**
 * Enregistre une passkey et scelle le mot de passe du coffre avec le secret
 * PRF fourni par le gestionnaire de clés. Le mot de passe reste la méthode de
 * secours : aucune donnée n'est rendue inaccessible si PRF n'est pas supporté.
 */
export async function registerPasskey(
  password: string,
  label = 'Clé d’accès de cet appareil',
): Promise<PasskeyInfo> {
  if (!isPasskeySupported()) {
    throw new PasskeyError(
      'unsupported',
      'Ce navigateur ne prend pas en charge les clés d’accès WebAuthn.',
    )
  }
  const prfSalt = randomBytes(32)
  const userId = randomBytes(16)

  let credential: PublicKeyCredential | null
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: RP_NAME, id: window.location.hostname },
        user: {
          id: userId,
          name: 'budget-analyzer',
          displayName: RP_NAME,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
        extensions: {
          prf: { eval: { first: prfSalt } },
        } as PublicKeyCredentialCreationOptions['extensions'],
      },
    })) as PublicKeyCredential | null
  } catch (cause) {
    throw classifyWebAuthnError(cause)
  }

  if (!credential) {
    throw new PasskeyError('cancelled', 'Aucune clé d’accès n’a été créée.')
  }

  const outputs = credential.getClientExtensionResults() as PrfOutputs | undefined
  let prfOutput = outputs?.prf?.results?.first
  if (!prfOutput) {
    // Certains gestionnaires ne renvoient PRF qu'à l'authentification
    // (Samsung Pass, par exemple). Une seconde cérémonie le récupère.
    prfOutput = await requestPrf(credential.rawId, prfSalt)
  }

  const key = await deriveWrappingKey(prfOutput, prfSalt)
  const sealed = await encryptPassword(password, key)
  const record: PasskeyRecord = {
    v: 1,
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    prfSalt: toBase64Url(prfSalt),
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    createdAt: new Date().toISOString(),
    label,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    throw new PasskeyError('failed', 'Impossible d’enregistrer la clé d’accès.')
  }
  return { createdAt: record.createdAt, label: record.label }
}

/**
 * Récupère le mot de passe du coffre après une cérémonie WebAuthn. Le mot de
 * passe est ensuite passé à `unlock()` comme d'habitude.
 */
export async function unlockWithPasskey(): Promise<string> {
  if (!isPasskeySupported()) {
    throw new PasskeyError('unsupported')
  }
  const record = readRecord()
  if (!record) {
    throw new PasskeyError('no-record', 'Aucune clé d’accès n’est enregistrée sur cet appareil.')
  }

  let prfOutput: ArrayBuffer
  try {
    prfOutput = await requestPrf(
      fromBase64Url(record.credentialId),
      fromBase64Url(record.prfSalt),
    )
  } catch (cause) {
    throw classifyWebAuthnError(cause)
  }

  try {
    const key = await deriveWrappingKey(prfOutput, fromBase64Url(record.prfSalt))
    return await decryptPassword(record, key)
  } catch {
    throw new PasskeyError(
      'failed',
      'La clé d’accès ne correspond plus à ce coffre. Utilisez le mot de passe, puis réenregistrez la clé.',
    )
  }
}

export function passkeyErrorMessage(cause: unknown): string {
  if (cause instanceof PasskeyError) {
    switch (cause.code) {
      case 'unsupported':
        return 'Ce navigateur ne prend pas en charge les clés d’accès. Utilisez le mot de passe.'
      case 'cancelled':
        return 'Opération annulée. Vous pouvez réessayer ou utiliser le mot de passe.'
      case 'no-prf':
        return 'Ce gestionnaire de clés ne fournit pas le secret nécessaire au chiffrement. Utilisez le mot de passe ou un autre gestionnaire (Google Password Manager, iCloud, 1Password).'
      case 'no-record':
        return 'Aucune clé d’accès n’est enregistrée sur cet appareil.'
      default:
        return cause.message
    }
  }
  return cause instanceof Error ? cause.message : 'La clé d’accès n’a pas pu être utilisée.'
}
