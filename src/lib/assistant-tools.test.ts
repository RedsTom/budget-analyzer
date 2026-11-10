import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_TOOL_DECLARATIONS,
  resolveToolRange,
  runAssistantTool,
  type AssistantToolContext,
} from './assistant-tools'
import type { BudgetPlan, Transaction } from './types'

interface Seed {
  date: string
  amount: number
  label: string
  category: string
  merchant: string
}

const SEED: Seed[] = [
  { date: '2026-06-01', amount: 2000, label: 'VIR SALAIRE EMPLOYEUR', category: 'revenus', merchant: 'employeur' },
  { date: '2026-06-02', amount: -800, label: 'LOYER APPARTEMENT', category: 'logement', merchant: 'bailleur' },
  { date: '2026-06-08', amount: -15.99, label: 'NETFLIX.COM', category: 'abonnements', merchant: 'netflix' },
  { date: '2026-07-01', amount: 2000, label: 'VIR SALAIRE EMPLOYEUR', category: 'revenus', merchant: 'employeur' },
  { date: '2026-07-02', amount: -800, label: 'LOYER APPARTEMENT', category: 'logement', merchant: 'bailleur' },
  { date: '2026-07-05', amount: -120.5, label: 'CARREFOUR CITY', category: 'alimentation', merchant: 'carrefour' },
  { date: '2026-07-08', amount: -15.99, label: 'NETFLIX.COM', category: 'abonnements', merchant: 'netflix' },
  { date: '2026-08-01', amount: 2000, label: 'VIR SALAIRE EMPLOYEUR', category: 'revenus', merchant: 'employeur' },
  { date: '2026-08-02', amount: -850, label: 'LOYER APPARTEMENT', category: 'logement', merchant: 'bailleur' },
  { date: '2026-08-04', amount: -45.2, label: 'CARREFOUR CITY', category: 'alimentation', merchant: 'carrefour' },
  { date: '2026-08-08', amount: -15.99, label: 'NETFLIX.COM', category: 'abonnements', merchant: 'netflix' },
]

function buildLedger(): Transaction[] {
  let solde = 0
  return SEED.map((seed, index) => {
    solde = Math.round((solde + seed.amount) * 100) / 100
    return {
      id: `t${index + 1}`,
      date: seed.date,
      valueDate: seed.date,
      debit: seed.amount < 0 ? seed.amount : null,
      credit: seed.amount > 0 ? seed.amount : null,
      amount: seed.amount,
      rawLabel: seed.label,
      solde,
      order: index + 1,
      sourceFile: 'test.csv',
      merchantKey: seed.merchant,
      categoryId: seed.category,
    }
  })
}

const BUDGETS: BudgetPlan[] = [
  { id: 'b-alimentation', categoryId: 'alimentation', name: 'Courses', monthlyLimit: 100 },
  { id: 'b-global', name: 'Global', monthlyLimit: 900 },
]

function context(overrides: Partial<AssistantToolContext> = {}): AssistantToolContext {
  return {
    transactions: buildLedger(),
    aliases: {},
    range: { start: '2026-07-01', end: '2026-07-31' },
    previousRange: { start: '2026-06-01', end: '2026-06-30' },
    label: 'juillet 2026',
    budgets: BUDGETS,
    customAllocations: { t6: 't8' },
    recurringDecisions: {},
    reference: '2026-08-08',
    ...overrides,
  }
}

describe('déclarations d’outils', () => {
  it('expose un nom unique et une description pour chaque outil', () => {
    const names = ASSISTANT_TOOL_DECLARATIONS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('search_transactions')
    expect(names).toContain('coverage_status')
    for (const tool of ASSISTANT_TOOL_DECLARATIONS) {
      expect(tool.description.length).toBeGreaterThan(20)
    }
  })
})

describe('resolveToolRange', () => {
  it('privilégie une plage explicite', () => {
    expect(
      resolveToolRange(context(), { date_start: '2026-01-01', date_end: '2026-03-31' }),
    ).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('inverse une plage saisie à l’envers', () => {
    expect(
      resolveToolRange(context(), { date_start: '2026-03-31', date_end: '2026-01-01' }),
    ).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('calcule une fenêtre en mois ancrée sur la référence', () => {
    expect(resolveToolRange(context(), { months: 2 })).toEqual({
      start: '2026-06-08',
      end: '2026-08-08',
    })
  })

  it('retombe sur la période globale sans paramètre', () => {
    expect(resolveToolRange(context(), {})).toEqual({ start: '2026-07-01', end: '2026-07-31' })
  })
})

describe('period_summary', () => {
  it('calcule les totaux de la période et rappelle la précédente', () => {
    const result = runAssistantTool('period_summary', {}, context())
    expect(result.summary).toMatchObject({
      entrees: 2000,
      depenses: 936.49,
      net: 1063.51,
      operations: 4,
      periode_precedente: { entrees: 2000, depenses: 815.99, net: 1184.01 },
    })
    expect(result.artifacts).toEqual([])
  })
})

describe('search_transactions', () => {
  it('trouve une contrepartie par texte et renvoie une carte cliquable', () => {
    const result = runAssistantTool('search_transactions', { query: 'carrefour' }, context())
    const summary = result.summary as { correspondances: number; operations: { id: string }[] }

    expect(summary.correspondances).toBe(1)
    expect(summary.operations[0].id).toBe('t6')
    expect(result.artifacts).toEqual([
      { type: 'transactions', title: 'Opérations « carrefour »', ids: ['t6'] },
    ])
  })

  it('filtre par sens et montant minimum', () => {
    const result = runAssistantTool(
      'search_transactions',
      { direction: 'income', min_amount: 500 },
      context(),
    )
    const summary = result.summary as { operations: { id: string }[] }
    expect(summary.operations.map((operation) => operation.id)).toEqual(['t4'])
  })

  it('filtre par catégorie', () => {
    const result = runAssistantTool(
      'search_transactions',
      { category: 'abonnements', direction: 'expense' },
      context(),
    )
    const summary = result.summary as { operations: { id: string }[] }
    expect(summary.operations.map((operation) => operation.id)).toEqual(['t7'])
  })

  it('renvoie un artefact vide sans correspondance', () => {
    const result = runAssistantTool('search_transactions', { query: 'introuvable' }, context())
    expect(result.artifacts).toEqual([])
  })
})

describe('get_transaction', () => {
  it('détaille une opération existante', () => {
    const result = runAssistantTool('get_transaction', { id: 't6' }, context())
    expect(result.summary).toMatchObject({
      trouvee: true,
      id: 't6',
      montant: -120.5,
      sens: 'depense',
      categorie: 'Alimentation',
    })
    expect(result.artifacts).toHaveLength(1)
  })

  it('signale un identifiant inconnu', () => {
    const result = runAssistantTool('get_transaction', { id: 'nope' }, context())
    expect(result.summary).toMatchObject({ trouvee: false })
    expect(result.artifacts).toEqual([])
  })
})

describe('agrégats', () => {
  it('classe les marchands par volume', () => {
    const result = runAssistantTool('top_merchants', {}, context())
    const summary = result.summary as { marchands: { nom: string; total: number }[] }
    expect(summary.marchands[0]).toMatchObject({ total: 800 })
    const artifact = result.artifacts[0]
    expect(artifact.type).toBe('merchants')
  })

  it('ventile les catégories et calcule les parts', () => {
    const result = runAssistantTool('category_breakdown', {}, context())
    const summary = result.summary as {
      total: number
      categories: { nom: string; total: number; part: number }[]
    }
    expect(summary.total).toBe(936.49)
    expect(summary.categories[0]).toMatchObject({ nom: 'Logement', total: 800 })
    const artifact = result.artifacts[0]
    expect(artifact.type).toBe('categories')
  })

  it('produit une série mensuelle pour la période', () => {
    const result = runAssistantTool('monthly_series', {}, context())
    const summary = result.summary as { mois: { mois: string; net: number }[] }
    expect(summary.mois).toHaveLength(1)
    expect(summary.mois[0]).toMatchObject({ mois: '2026-07', net: 1063.51 })
  })

  it('borne l’historique de solde et donne les extrêmes', () => {
    const result = runAssistantTool('balance_history', { days: 30 }, context())
    expect(result.summary).toMatchObject({ solde_final: 3336.33, maximum: 4247.52 })
    const artifact = result.artifacts[0]
    expect(artifact.type).toBe('balance')
  })
})

describe('budgets', () => {
  it('évalue les plafonds sur le mois de référence', () => {
    const result = runAssistantTool('budget_status', {}, context())
    const summary = result.summary as {
      mois: string
      depassements: number
      budgets: { nom: string; depense: number; depasse: boolean }[]
    }
    expect(summary.mois).toBe('2026-08')
    expect(summary.depassements).toBe(1)
    expect(summary.budgets.find((budget) => budget.nom === 'Courses')).toMatchObject({
      depense: 45.2,
      depasse: false,
    })
    expect(summary.budgets.find((budget) => budget.nom === 'Global')).toMatchObject({
      depense: 911.19,
      depasse: true,
    })
  })
})

describe('récurrences, couverture et affectations', () => {
  it('liste les séries en attente avec leur fréquence', () => {
    const result = runAssistantTool('recurring_series', { status: 'pending' }, context())
    const summary = result.summary as { series: { libelle: string; frequence: string }[] }
    const netflix = summary.series.find((serie) => /netflix/i.test(serie.libelle))
    expect(netflix).toBeDefined()
    expect(netflix?.frequence).toBe('Mensuel')
    expect(result.artifacts[0]?.type).toBe('recurring')
  })

  it('expose la couverture FIFO des crédits', () => {
    const result = runAssistantTool('coverage_status', {}, context())
    const summary = result.summary as { credits: { credit_id: string; montant: number }[] }
    expect(summary.credits.length).toBeGreaterThan(0)
    expect(summary.credits[0].montant).toBe(2000)
    expect(result.artifacts[0]?.type).toBe('coverage')
  })

  it('relie une affectation manuelle à ses deux opérations', () => {
    const result = runAssistantTool('allocations', {}, context())
    const summary = result.summary as {
      affectations: { depense: string; credit: string; montant_depense: number }[]
    }
    expect(summary.affectations).toHaveLength(1)
    expect(summary.affectations[0]).toMatchObject({ montant_depense: -120.5 })
    expect(summary.affectations[0].depense).toMatch(/carrefour/i)
    expect(result.artifacts[0]?.type).toBe('allocations')
  })
})

describe('runAssistantTool', () => {
  it('rejette un outil inconnu', () => {
    expect(() => runAssistantTool('inconnu', {}, context())).toThrow('Outil inconnu')
  })
})
