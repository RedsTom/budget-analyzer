import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analyzePeriod,
  askAssistant,
  askAssistantWithTools,
  buildAnalysisPrompt,
  buildAssistantPrompt,
  buildBudgetProposalsPrompt,
  buildMerchantPrompt,
  cleanAssistantChatText,
  isAiSupported,
  mergeAssistantArtifacts,
  normalizeSuggestedName,
  parseBudgetProposalResponse,
  parseMerchantBatchResponse,
  parseMerchantCategoryResponse,
  parseRecurringBatchResponse,
  suggestMerchantName,
  type AssistantContext,
} from './ai'
import type { AssistantToolContext } from './assistant-tools'
import type { AssistantArtifact, Transaction } from './types'

describe('normalizeSuggestedName', () => {
  it('extrait le nom d’une réponse JSON', () => {
    expect(normalizeSuggestedName('{"name":"Carrefour City"}')).toBe('Carrefour City')
  })

  it('nettoie guillemets, préfixe et espaces', () => {
    expect(normalizeSuggestedName('  Nom : «  Boulangerie Martin »  ')).toBe(
      'Boulangerie Martin',
    )
  })

  it('ne garde que la première ligne utile', () => {
    expect(normalizeSuggestedName('Netflix\nExplication inutile')).toBe('Netflix')
  })

  it('rejette une réponse vide, trop longue ou avec une référence', () => {
    expect(normalizeSuggestedName('')).toBeNull()
    expect(normalizeSuggestedName('A')).toBeNull()
    expect(normalizeSuggestedName('A'.repeat(61))).toBeNull()
    expect(normalizeSuggestedName('Référence 1234567')).toBeNull()
  })
})

describe('buildMerchantPrompt', () => {
  it('dédoublonne et limite les libellés', () => {
    const labels = ['A', 'A', ...Array.from({ length: 15 }, (_, i) => `L${i}`)]
    const prompt = buildMerchantPrompt(labels, 'Ancien nom')
    expect(prompt.startsWith('Libellés bancaires bruts de ce marchand :')).toBe(true)
    expect(prompt.match(/^- /gm)).toHaveLength(12)
    expect(prompt).toContain('Nom actuel : Ancien nom')
  })
})

describe('buildAnalysisPrompt', () => {
  const input = {
    label: '12 derniers mois',
    totals: { income: 24_000, expenses: 18_000, net: 6_000, savingsRate: 0.25 },
    previous: { income: 22_000, expenses: 19_000, net: 3_000 },
    topCategories: [
      { name: 'Alimentation', total: 4_000, share: 0.4 },
      { name: 'Logement', total: 3_000, share: 0.3 },
    ],
    topMerchants: [{ name: 'Carrefour', total: 1_200 }],
    recurringMonthly: 450,
  }

  it('injecte les agrégats et les postes principaux', () => {
    const prompt = buildAnalysisPrompt(input)
    expect(prompt).toContain('12 derniers mois')
    expect(prompt).toContain('24000.00 EUR')
    expect(prompt).toContain('Alimentation : 4000.00 EUR (40 %)')
    expect(prompt).toContain('Carrefour : 1200.00 EUR')
    expect(prompt).toContain('450.00 EUR par mois')
    expect(prompt).toContain('Taux d’épargne : 25 %')
  })

  it('signale un taux d’épargne non calculable', () => {
    const prompt = buildAnalysisPrompt({
      ...input,
      totals: { ...input.totals, savingsRate: null },
      topMerchants: [],
      recurringMonthly: 0,
    })
    expect(prompt).toContain('Taux d’épargne non calculable')
    expect(prompt).not.toContain('Principaux marchands')
  })
})

describe('isAiSupported', () => {
  it('est vrai si fetch est disponible', () => {
    expect(isAiSupported()).toBe(true)
  })
})

describe('Gestion des clés API', () => {
  it('échoue proprement sans clé API pour suggestMerchantName', async () => {
    const res = await suggestMerchantName(['CARREFOUR'])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('Clé API non configurée.')
    }
  })

  it('échoue si aucun libellé fourni', async () => {
    const res = await suggestMerchantName([], undefined, 'test-key')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('Aucun libellé à analyser.')
    }
  })

  it('échoue proprement sans clé API pour analyzePeriod', async () => {
    const res = await analyzePeriod({
      label: 'test',
      totals: { income: 0, expenses: 0, net: 0, savingsRate: null },
      previous: { income: 0, expenses: 0, net: 0 },
      topCategories: [],
      topMerchants: [],
      recurringMonthly: 0,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('Clé API non configurée.')
    }
  })

  it('gère une liste vide pour batchSuggestMerchantNames', async () => {
    const { batchSuggestMerchantNames } = await import('./ai')
    const res = await batchSuggestMerchantNames([], 'key')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([])
    }
  })

  it('échoue sans clé pour batchSuggestMerchantNames', async () => {
    const { batchSuggestMerchantNames } = await import('./ai')
    const res = await batchSuggestMerchantNames([{ key: 'k', labels: ['l'] }])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('Clé API non configurée.')
    }
  })

  it('gère une liste vide pour batchAnalyzeRecurring', async () => {
    const { batchAnalyzeRecurring } = await import('./ai')
    const res = await batchAnalyzeRecurring([], 'key')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([])
    }
  })
})

describe('parseMerchantBatchResponse', () => {
  it('extrait les entrées valides et nettoie les noms', () => {
    const raw =
      'Voici : [{"key":"a","name":"Carrefour"},{"key":"b","name":"« Netflix »"},{"key":"c","name":"Référence 1234567"}]'
    expect(parseMerchantBatchResponse(raw)).toEqual([
      { key: 'a', name: 'Carrefour' },
      { key: 'b', name: 'Netflix' },
    ])
  })

  it('retourne un tableau vide si le JSON est absent ou invalide', () => {
    expect(parseMerchantBatchResponse('aucune réponse')).toEqual([])
    expect(parseMerchantBatchResponse('[{"key":1}]')).toEqual([])
    expect(parseMerchantBatchResponse('[{oops}]')).toEqual([])
  })
})

describe('parseRecurringBatchResponse', () => {
  it('ne conserve que les décisions acceptées ou refusées', () => {
    const raw =
      '[{"id":"a","decision":"accepted","reason":"loyer"},{"id":"b","decision":"maybe"},{"id":"c","decision":"refused"}]'
    expect(parseRecurringBatchResponse(raw)).toEqual([
      { id: 'a', decision: 'accepted', reason: 'loyer' },
      { id: 'c', decision: 'refused', reason: '' },
    ])
  })

  it('retourne un tableau vide si le JSON est absent', () => {
    expect(parseRecurringBatchResponse('rien')).toEqual([])
    expect(parseRecurringBatchResponse('[not json]')).toEqual([])
  })
})

describe('parseMerchantCategoryResponse', () => {
  it('garde les catégories connues et borne la confiance', () => {
    const raw =
      '[{"key":"a","categoryId":"alimentation","confidence":1.4},{"key":"b","categoryId":"inconnue","confidence":0.9},{"key":"c","categoryId":"transport"}]'
    expect(parseMerchantCategoryResponse(raw)).toEqual([
      { key: 'a', categoryId: 'alimentation', confidence: 1 },
      { key: 'c', categoryId: 'transport', confidence: 0.6 },
    ])
  })

  it('retourne un tableau vide si le JSON est invalide', () => {
    expect(parseMerchantCategoryResponse('pas de tableau')).toEqual([])
    expect(parseMerchantCategoryResponse('[{oops}]')).toEqual([])
  })
})

describe('parseBudgetProposalResponse', () => {
  it('arrondit les plafonds valides et ignore le reste', () => {
    const raw =
      '[{"categoryId":"alimentation","monthlyLimit":123.456,"reason":"marge"},{"categoryId":"revenus","monthlyLimit":-10},{"categoryId":"loisirs","monthlyLimit":2000000}]'
    expect(parseBudgetProposalResponse(raw)).toEqual([
      { categoryId: 'alimentation', monthlyLimit: 123.46, reason: 'marge' },
    ])
  })
})

describe('buildBudgetProposalsPrompt', () => {
  it('inclut les moyennes, le revenu et les budgets existants', () => {
    const prompt = buildBudgetProposalsPrompt(
      [
        {
          categoryId: 'alimentation',
          name: 'Alimentation',
          monthlyAverage: 180.5,
          lastMonth: 160,
          months: 3,
        },
      ],
      { months: 3, totalMonthlyIncome: 2200, existing: ['Courses 150 EUR'] },
    )
    expect(prompt).toContain('alimentation')
    expect(prompt).toContain('2200.00 EUR')
    expect(prompt).toContain('Courses 150 EUR')
    expect(prompt).toContain('3 mois')
  })
})

describe('buildAssistantPrompt', () => {
  const context: AssistantContext = {
    periodLabel: '12 derniers mois',
    totals: { income: 1000, expenses: 800, net: 200, savingsRate: 0.2 },
    categories: [{ name: 'Alimentation', total: 300, share: 0.375 }],
    merchants: [{ name: 'Carrefour', total: 120 }],
    monthly: [{ month: '2026-10', income: 1000, expenses: 800 }],
  }

  it('inclut la question, la période et l’historique récent', () => {
    const prompt = buildAssistantPrompt(context, 'Où part mon argent ?', [
      { question: 'Et le mois d’avant ?', answer: 'Dépenses stables.' },
    ])
    expect(prompt).toContain('Où part mon argent ?')
    expect(prompt).toContain('12 derniers mois')
    expect(prompt).toContain('Et le mois d’avant ?')
    expect(prompt).toContain('aucun IBAN')
    expect(prompt).not.toContain('rawLabel')
  })
})

describe('askAssistant', () => {
  it('échoue sans clé API', async () => {
    const result = await askAssistant(
      {
        periodLabel: 'période',
        totals: { income: 0, expenses: 0, net: 0, savingsRate: null },
        categories: [],
        merchants: [],
        monthly: [],
      },
      'Synthèse ?',
      null,
    )
    expect(result).toEqual({ ok: false, error: 'Clé API non configurée.' })
  })

  it('refuse une question vide', async () => {
    const result = await askAssistant(
      {
        periodLabel: 'période',
        totals: { income: 0, expenses: 0, net: 0, savingsRate: null },
        categories: [],
        merchants: [],
        monthly: [],
      },
      '   ',
      'clé',
    )
    expect(result.ok).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Chat à outils                                                              */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function toolContext(): AssistantToolContext {
  const transactions: Transaction[] = [
    {
      id: 'n1',
      date: '2026-07-08',
      valueDate: '2026-07-08',
      debit: -15.99,
      credit: null,
      amount: -15.99,
      rawLabel: 'NETFLIX.COM',
      solde: 100,
      order: 1,
      sourceFile: 'test.csv',
      merchantKey: 'netflix',
      categoryId: 'abonnements',
    },
  ]
  return {
    transactions,
    aliases: {},
    range: { start: '2026-07-01', end: '2026-07-31' },
    label: 'juillet 2026',
    reference: '2026-07-08',
  }
}

describe('askAssistantWithTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exécute un outil, renvoie les artefacts et conserve signature et identifiant', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thoughtSignature: 'sig-1',
                    functionCall: {
                      name: 'search_transactions',
                      args: { query: 'netflix' },
                      id: 'call_1',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            { content: { parts: [{ text: '**Netflix** coûte 15,99 € par mois.' }] } },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await askAssistantWithTools({
      question: 'Parle-moi de Netflix',
      history: [],
      context: toolContext(),
      apiKey: 'test-key',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.toolCalls).toBe(1)
    expect(result.value.text).toContain('Netflix')
    expect(result.value.artifacts[0]).toMatchObject({ type: 'transactions', ids: ['n1'] })

    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toContain('gemini-3.8-flash')

    const firstPayload = JSON.parse(String(calls[0][1]?.body)) as {
      tools: { functionDeclarations: unknown[] }[]
    }
    expect(firstPayload.tools[0].functionDeclarations.length).toBeGreaterThan(5)

    const secondPayload = JSON.parse(String(calls[1][1]?.body)) as {
      contents: {
        parts: {
          thoughtSignature?: string
          functionResponse?: { name: string; id?: string; response: { result: { correspondances: number } } }
        }[]
      }[]
    }
    expect(secondPayload.contents[1].parts[0].thoughtSignature).toBe('sig-1')
    expect(secondPayload.contents[2].parts[0].functionResponse).toMatchObject({
      name: 'search_transactions',
      id: 'call_1',
    })
    expect(secondPayload.contents[2].parts[0].functionResponse?.response.result.correspondances).toBe(
      1,
    )
  })

  it('garde les recherches intermédiaires invisibles et n’affiche que les artefacts choisis', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search_transactions',
                      args: { query: 'netflix' },
                      id: 'c1',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'category_breakdown', args: {}, id: 'c2' } }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'present_artifacts',
                      args: { indices: [2] },
                      id: 'c3',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'Voici la répartition.' }] } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await askAssistantWithTools({
      question: 'Où part mon argent ?',
      context: toolContext(),
      apiKey: 'test-key',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.artifacts).toHaveLength(1)
    expect(result.value.artifacts[0].type).toBe('categories')

    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      contents: {
        parts: {
          functionResponse?: {
            response: { artefacts_disponibles?: { index: number; type: string }[] }
          }
        }[]
      }[]
    }
    expect(
      secondPayload.contents[2].parts[0].functionResponse?.response.artefacts_disponibles,
    ).toEqual([{ index: 1, type: 'transactions', titre: 'Opérations « netflix »' }])
  })

  it('bascule sur le modèle de repli quand le premier est saturé', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'high demand' } }, 503))
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'Réponse de repli.' }] } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await askAssistantWithTools({
      question: 'Résume',
      context: toolContext(),
      apiKey: 'test-key',
    })

    expect(result.ok).toBe(true)
    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toContain('gemini-3.8-flash')
    expect(calls[1][0]).toContain('gemini-3.5-flash-lite')
  })

  it('signale un outil en échec sans interrompre la réponse', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            { content: { parts: [{ functionCall: { name: 'outil_inconnu', args: {} } }] } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'Je ne peux pas.' }] } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await askAssistantWithTools({
      question: 'Test',
      context: toolContext(),
      apiKey: 'test-key',
    })

    expect(result.ok).toBe(true)
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      contents: { parts: { functionResponse?: { response: { error?: string } } }[] }[]
    }
    expect(secondPayload.contents[2].parts[0].functionResponse?.response.error).toContain(
      'Outil inconnu',
    )
  })

  it('échoue sans clé API ou sans question', async () => {
    expect(
      await askAssistantWithTools({ question: 'Test', context: toolContext(), apiKey: null }),
    ).toEqual({ ok: false, error: 'Clé API non configurée.' })

    expect(
      await askAssistantWithTools({ question: '  ', context: toolContext(), apiKey: 'clé' }),
    ).toEqual({ ok: false, error: 'Posez une question pour continuer.' })
  })
})

describe('mergeAssistantArtifacts', () => {
  it('supprime les doublons et borne le nombre d’artefacts', () => {
    const base: AssistantArtifact = { type: 'transactions', title: 'x', ids: ['1'] }
    expect(mergeAssistantArtifacts([base, base])).toEqual([base])

    const many: AssistantArtifact[] = Array.from({ length: 7 }, (_, index) => ({
      type: 'transactions',
      title: `t${index}`,
      ids: [String(index)],
    }))
    expect(mergeAssistantArtifacts(many)).toHaveLength(5)
    expect(mergeAssistantArtifacts(many).at(-1)?.title).toBe('t6')
  })
})

describe('cleanAssistantChatText', () => {
  it('retire les titres markdown mais conserve le gras et les paragraphes', () => {
    expect(cleanAssistantChatText('## Titre\n\n**gras**\n\n\nfin')).toBe(
      'Titre\n\n**gras**\n\nfin',
    )
  })
})

