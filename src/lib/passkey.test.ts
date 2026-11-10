import { describe, expect, it } from 'vitest'
import {
  hasPasskey,
  isPasskeySupported,
  PasskeyError,
  passkeyErrorMessage,
  removePasskey,
} from './passkey'

describe('passkey', () => {
  it('est silencieusement indisponible hors navigateur', () => {
    expect(isPasskeySupported()).toBe(false)
    expect(hasPasskey()).toBe(false)
    expect(() => removePasskey()).not.toThrow()
  })

  it('explique les échecs PRF sans jargon', () => {
    expect(passkeyErrorMessage(new PasskeyError('no-prf'))).toContain(
      'secret nécessaire',
    )
    expect(passkeyErrorMessage(new PasskeyError('unsupported'))).toContain(
      'mot de passe',
    )
    expect(passkeyErrorMessage(new PasskeyError('cancelled'))).toContain(
      'annulée',
    )
  })
})
