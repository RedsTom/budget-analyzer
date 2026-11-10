import { describe, expect, it } from 'vitest'
import {
  autoDisplayName,
  buildMerchantKey,
  cleanLabel,
  resolveDisplayName,
} from './labels'

describe('cleanLabel', () => {
  it('retire préfixe, ville, carte et référence', () => {
    expect(
      cleanLabel(
        'PAIEMENT PSC 2308 CLERMONT FERR O RAMEN CARTE 7839 HIR012623612763093',
      ),
    ).toBe('O RAMEN')

    expect(
      cleanLabel('VIR DE MME CAMILLE MOREL CH3V26237L006035'),
    ).toBe('CAMILLE MOREL')
  })

  it('nettoie un prélèvement SEPA', () => {
    expect(
      cleanLabel(
        'PRLV SEPA PAYPAL EUROPE S A R L 1052563520913/PAYPAL',
      ),
    ).toBe('PAYPAL EUROPE S A R L')
  })

  it('ne produit jamais une chaîne vide', () => {
    expect(cleanLabel('CARTE 7839')).toBe('CARTE')
    expect(cleanLabel('HIR012623612763093')).toBe('')
  })
})

describe('buildMerchantKey', () => {
  it('regroupe les écritures du même marchand', () => {
    const first = buildMerchantKey(
      'PAIEMENT PSC 2508 CLERMONT FERR PHARMACIE LEON B CARTE 7839 HIR012623802811936',
    )
    const second = buildMerchantKey(
      'PAIEMENT PSC 2808 CLERMONT FERR PHARMACIE LEON B CARTE 7839 HIR012624303601302',
    )
    expect(first).toBe(second)
    expect(first).toContain('PHARMACIE LEON')
  })

  it('ne confond pas deux marchands', () => {
    expect(
      buildMerchantKey('PAIEMENT PSC 2508 CLERMONT FERR IKEA CLERMONT CARTE 7839'),
    ).not.toBe(
      buildMerchantKey('PAIEMENT PSC 2508 CLERMONT FERR LIDL 4147 CARTE 7839'),
    )
  })
})

describe('autoDisplayName', () => {
  it('met le nom en forme lisible', () => {
    expect(
      autoDisplayName(
        'PAIEMENT PSC 2308 CLERMONT FERR O RAMEN CARTE 7839 HIR012623612763093',
      ),
    ).toBe('O Ramen')
  })
})

describe('resolveDisplayName', () => {
  const transaction = {
    rawLabel: 'PAIEMENT PSC 2308 CLERMONT FERR O RAMEN CARTE 7839',
    merchantKey: 'O RAMEN',
  }

  it('applique la priorité transaction > alias > auto', () => {
    expect(resolveDisplayName(transaction, {})).toBe('O Ramen')
    expect(
      resolveDisplayName(transaction, {
        'O RAMEN': { displayName: 'Ramen du midi' },
      }),
    ).toBe('Ramen du midi')
    expect(
      resolveDisplayName(
        { ...transaction, displayName: 'Déjeuner' },
        { 'O RAMEN': { displayName: 'Ramen du midi' } },
      ),
    ).toBe('Déjeuner')
  })
})
