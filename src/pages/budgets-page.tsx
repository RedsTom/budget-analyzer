import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Edit,
  PiggyBank,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AiInsightCard } from '@/components/ai-insight-card'
import { CategoryBadge } from '@/components/category-badge'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import {
  askAssistant,
  BUDGET_ANALYSIS_QUESTION,
  proposeBudgets,
  type BudgetCategoryStat,
  type BudgetProposal,
} from '@/lib/ai'
import { aiFailureFromMessage } from '@/lib/ai-errors'
import { guardAiOnline, notifyAiFailure } from '@/lib/ai-notify'
import { buildAssistantContext } from '@/lib/assistant-context'
import { CATEGORIES, categoryById, categoryIdOf } from '@/lib/categories'
import { formatAmount, formatCount } from '@/lib/format'
import { referenceDate } from '@/lib/period'
import type { BudgetPlan } from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'

function monthKeysEndingAt(monthKey: string, count: number): string[] {
  const [year, month] = monthKey.split('-').map(Number)
  const keys: string[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1)
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function BudgetsPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const budgets = useVaultStore((state) => state.budgets)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const saveBudget = useVaultStore((state) => state.saveBudget)
  const saveBudgets = useVaultStore((state) => state.saveBudgets)
  const deleteBudget = useVaultStore((state) => state.deleteBudget)
  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const { range, previous, label } = usePeriod()

  // Les budgets sont mensuels : on évalue le mois de référence du jeu de données,
  // pas la période globale (qui peut couvrir plusieurs mois).
  const reference = referenceDate(transactions)
  const monthKey = reference.slice(0, 7)
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
        new Date(`${monthKey}-01T00:00:00`),
      ),
    [monthKey],
  )

  // Modal d'ajout / édition
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<BudgetPlan | null>(null)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('all')
  const [monthlyLimit, setMonthlyLimit] = useState('')
  const [proposing, setProposing] = useState(false)
  const [applyingProposals, setApplyingProposals] = useState(false)
  const [proposals, setProposals] = useState<BudgetProposal[] | null>(null)

  // Dépenses réelles du mois de référence, par catégorie
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>()
    let totalAll = 0
    for (const tx of transactions) {
      if (tx.date.slice(0, 7) !== monthKey) continue
      if (tx.amount < 0) {
        const cat = categoryIdOf(tx, aliases)
        const absAmount = -tx.amount
        map.set(cat, (map.get(cat) ?? 0) + absAmount)
        totalAll += absAmount
      }
    }
    return { map, totalAll }
  }, [transactions, aliases, monthKey])

  // Calcul des statistiques globales sur les budgets
  const summary = useMemo(() => {
    const totalBudgeted = budgets.reduce((total, budget) => total + budget.monthlyLimit, 0)

    // Un budget global couvre déjà toutes les dépenses : on évite de compter
    // deux fois les catégories lorsqu'un plafond global coexiste.
    const hasGlobal = budgets.some((budget) => !budget.categoryId || budget.categoryId === 'all')
    let totalSpentOnBudgets = 0
    if (hasGlobal) {
      totalSpentOnBudgets = expensesByCategory.totalAll
    } else {
      const scopedCategories = new Set(
        budgets
          .map((budget) => budget.categoryId)
          .filter((id): id is string => Boolean(id) && id !== 'all'),
      )
      for (const categoryId of scopedCategories) {
        totalSpentOnBudgets += expensesByCategory.map.get(categoryId) ?? 0
      }
    }

    const remaining = totalBudgeted - totalSpentOnBudgets
    const pct = totalBudgeted > 0 ? Math.round((totalSpentOnBudgets / totalBudgeted) * 100) : 0

    // Les deux montants ne coïncident pas quand seules quelques catégories sont
    // plafonnées : on affiche la dépense réelle du mois, la jauge reste bornée
    // aux catégories couvertes par un budget.
    return {
      totalBudgeted,
      totalSpentOnBudgets,
      spentThisMonth: expensesByCategory.totalAll,
      remaining,
      pct,
    }
  }, [budgets, expensesByCategory])

  const history = useMemo(() => {
    const months = monthKeysEndingAt(monthKey, 3)
    const byCategory = new Map<string, { total: number; seen: Set<string>; lastMonth: number }>()
    let income = 0
    const incomeMonths = new Set<string>()

    for (const transaction of transactions) {
      const key = transaction.date.slice(0, 7)
      if (!months.includes(key)) continue
      if (transaction.amount < 0) {
        const id = categoryIdOf(transaction, aliases)
        const current = byCategory.get(id) ?? { total: 0, seen: new Set<string>(), lastMonth: 0 }
        const amount = -transaction.amount
        current.total += amount
        current.seen.add(key)
        if (key === monthKey) current.lastMonth += amount
        byCategory.set(id, current)
      } else if (transaction.amount > 0) {
        income += transaction.amount
        incomeMonths.add(key)
      }
    }

    const stats: BudgetCategoryStat[] = [...byCategory.entries()]
      .filter(([id]) => id !== 'revenus' && id !== 'transferts')
      .map(([id, entry]) => ({
        categoryId: id,
        name: categoryById(id).name,
        monthlyAverage: entry.total / entry.seen.size,
        lastMonth: entry.lastMonth,
        months: entry.seen.size,
      }))
      .sort((a, b) => b.monthlyAverage - a.monthlyAverage)

    return {
      stats,
      months: months.length,
      income: incomeMonths.size > 0 ? income / incomeMonths.size : null,
    }
  }, [transactions, aliases, monthKey])

  const aiContext = useMemo(
    () =>
      buildAssistantContext({
        transactions,
        range,
        previousRange: previous,
        label,
        aliases,
        recurringDecisions,
        budgets,
        customAllocations,
      }),
    [transactions, range, previous, label, aliases, recurringDecisions, budgets, customAllocations],
  )

  async function handlePropose() {
    if (!aiApiKey) return
    if (!guardAiOnline(() => void handlePropose())) return
    setProposing(true)
    try {
      const result = await proposeBudgets(
        history.stats,
        {
          months: history.months,
          totalMonthlyIncome: history.income,
          existing: budgets.map((budget) => `${budget.name} ${budget.monthlyLimit.toFixed(0)} EUR`),
        },
        aiApiKey,
      )
      if (!result.ok) {
        notifyAiFailure(
          result.failure ?? aiFailureFromMessage(result.error),
          () => void handlePropose(),
        )
        toast.error(result.error)
        return
      }
      setProposals(result.value)
    } finally {
      setProposing(false)
    }
  }

  async function applyProposals() {
    if (!proposals || proposals.length === 0) return
    setApplyingProposals(true)
    try {
      const next = [...budgets]
      for (const proposal of proposals) {
        const index = next.findIndex((budget) => budget.categoryId === proposal.categoryId)
        if (index >= 0) {
          next[index] = { ...next[index], monthlyLimit: proposal.monthlyLimit }
        } else {
          next.push({
            id: `budget:${proposal.categoryId}:${Date.now()}`,
            name: categoryById(proposal.categoryId).name,
            categoryId: proposal.categoryId,
            monthlyLimit: proposal.monthlyLimit,
          })
        }
      }
      await saveBudgets(next)
      toast.success(
        `${proposals.length} plafond${proposals.length > 1 ? 's' : ''} appliqué${proposals.length > 1 ? 's' : ''}`,
      )
      setProposals(null)
    } catch {
      toast.error('Application des budgets impossible')
    } finally {
      setApplyingProposals(false)
    }
  }

  function handleOpenCreate() {
    setEditingBudget(null)
    setName('')
    setCategoryId('all')
    setMonthlyLimit('')
    setDialogOpen(true)
  }

  function handleOpenEdit(budget: BudgetPlan) {
    setEditingBudget(budget)
    setName(budget.name)
    setCategoryId(budget.categoryId ?? 'all')
    setMonthlyLimit(budget.monthlyLimit.toString())
    setDialogOpen(true)
  }

  async function handleSave() {
    const limitNum = parseFloat(monthlyLimit.replace(',', '.'))
    if (!name.trim()) {
      toast.error('Veuillez indiquer un nom pour ce budget.')
      return
    }
    if (isNaN(limitNum) || limitNum <= 0) {
      toast.error('Veuillez indiquer un montant mensuel valide supérieur à 0.')
      return
    }

    const budgetToSave: BudgetPlan = {
      id: editingBudget ? editingBudget.id : `budget:${Date.now()}`,
      name: name.trim(),
      categoryId: categoryId === 'all' ? undefined : categoryId,
      monthlyLimit: limitNum,
    }

    try {
      await saveBudget(budgetToSave)
      toast.success(editingBudget ? 'Budget mis à jour' : 'Budget créé avec succès')
      setDialogOpen(false)
    } catch {
      toast.error('Erreur lors de la sauvegarde du budget.')
    }
  }

  async function handleDelete(budgetId: string) {
    try {
      await deleteBudget(budgetId)
      toast.success('Budget supprimé')
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion des budgets"
        description={`Fixez vos objectifs de dépenses mensuelles par catégorie et suivez votre consommation du mois de ${monthLabel}.`}
        actions={
          <>
            {aiEnabled && aiApiKey ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handlePropose()}
                disabled={proposing}
              >
                <Sparkles className="size-3.5" />
                {proposing ? 'Analyse…' : 'Proposer des budgets'}
              </Button>
            ) : null}
            <Button onClick={handleOpenCreate} size="sm">
              <Plus className="size-4" />
              Nouveau budget
            </Button>
          </>
        }
      />

      {/* KPI de suivi budgétaire */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Plafond total budgété"
          value={formatAmount(summary.totalBudgeted)}
          hint={`${formatCount(budgets.length)} budget${budgets.length > 1 ? 's' : ''} actif${budgets.length > 1 ? 's' : ''}`}
          icon={<Target className="size-3.5" />}
        />
        <StatCard
          label="Dépensé ce mois"
          value={formatAmount(summary.spentThisMonth)}
          hint={
            budgets.length === 0
              ? 'Aucun plafond défini pour l’instant'
              : `dont ${formatAmount(summary.totalSpentOnBudgets)} dans les catégories budgétées`
          }
          icon={<TrendingUp className="size-3.5" />}
          accent={summary.pct > 100 ? 'expense' : undefined}
        />
        <StatCard
          label="Solde restant disponible"
          value={formatAmount(summary.remaining)}
          hint={
            summary.remaining >= 0
              ? 'Marge budgétaire restante'
              : 'Dépassement du budget global'
          }
          icon={<Wallet className="size-3.5" />}
          accent={summary.remaining < 0 ? 'expense' : 'income'}
        />
        <StatCard
          label="Consommation globale"
          value={`${summary.pct} %`}
          hint={
            summary.pct <= 80
              ? 'Dépenses sous contrôle'
              : summary.pct <= 100
                ? 'Attention au plafond'
                : 'Plafond dépassé'
          }
          icon={
            summary.pct <= 100 ? (
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            ) : (
              <AlertCircle className="size-3.5 text-destructive" />
            )
          }
        />
      </section>

      <AiInsightCard
        title="Diagnostic des budgets"
        description="Lecture des plafonds et des dépenses du mois de référence. Seuls les agrégats sont transmis."
        cta="Diagnostiquer"
        hint="Repérez les catégories qui dérivent et celles dont le plafond est trop large."
        allowPrompt
        placeholder="Ex : mon plafond alimentation est-il réaliste ?"
        suggestions={['Quels plafonds ajuster ?', 'Où je dépasse ?', 'Où j’ai de la marge ?']}
        onRun={(question) => askAssistant(aiContext, question ?? BUDGET_ANALYSIS_QUESTION, aiApiKey)}
      />

      {/* Grille des budgets */}
      {budgets.length === 0 ? (
        <Card className="border-dashed py-12 text-center">
          <CardContent className="space-y-4">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PiggyBank className="size-6" />
            </div>
            <div className="space-y-1">
              <CardTitle>Aucun budget défini</CardTitle>
              <CardDescription>
                Créez votre premier budget (ex: "Alimentation 400 €/mois") pour suivre facilement
                vos limites de dépenses.
              </CardDescription>
            </div>
            <Button onClick={handleOpenCreate} className="gap-1.5">
              <Plus className="size-4" />
              Créer mon premier budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => {
            const spent =
              !budget.categoryId || budget.categoryId === 'all'
                ? expensesByCategory.totalAll
                : (expensesByCategory.map.get(budget.categoryId) ?? 0)

            const pct = budget.monthlyLimit > 0 ? Math.round((spent / budget.monthlyLimit) * 100) : 0
            const remaining = budget.monthlyLimit - spent
            const isOver = remaining < 0

            return (
              <Card
                key={budget.id}
                className={`flex flex-col justify-between transition-all hover:border-primary/40 ${
                  isOver ? 'border-destructive/40 bg-destructive/[0.02]' : ''
                }`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold">{budget.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {budget.categoryId ? (
                        <CategoryBadge categoryId={budget.categoryId} />
                      ) : (
                        <Badge variant="outline" className="text-[11px]">
                          Toutes catégories
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => handleOpenEdit(budget)}
                      title="Modifier ce budget"
                    >
                      <Edit className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(budget.id)}
                      title="Supprimer ce budget"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground">
                        {formatAmount(spent)}
                      </span>
                      <span className="text-muted-foreground">
                        sur {formatAmount(budget.monthlyLimit)}
                      </span>
                    </div>

                    <Progress
                      value={Math.min(100, pct)}
                      className={`h-2 ${
                        isOver
                          ? '[&>div]:bg-destructive'
                          : pct >= 80
                            ? '[&>div]:bg-amber-500'
                            : '[&>div]:bg-emerald-500'
                      }`}
                    />

                    <div className="flex items-center justify-between text-[11px]">
                      <span className={isOver ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                        {isOver ? `Dépassement de ${formatAmount(-remaining)}` : `Reste ${formatAmount(remaining)}`}
                      </span>
                      <span className={`font-semibold ${isOver ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {pct} %
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal Création / Édition Budget */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingBudget ? 'Modifier le budget' : 'Définir un nouveau budget'}
            </DialogTitle>
            <DialogDescription>
              Fixez un montant maximal de dépenses mensuelles pour une catégorie ou pour l'ensemble.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="budget-name">Nom du budget</Label>
              <Input
                id="budget-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex : Courses du mois, Restaurants, Loisirs..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="budget-category">Catégorie associée</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="budget-category">
                  <SelectValue placeholder="Toutes catégories" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">Toutes catégories (Budget global)</SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="budget-limit">Plafond mensuel (€)</Label>
              <Input
                id="budget-limit"
                type="number"
                step="10"
                min="0"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                placeholder="Ex : 400"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => void handleSave()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={proposals !== null} onOpenChange={(open) => !open && setProposals(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Plafonds proposés
            </DialogTitle>
            <DialogDescription>
              Moyennes des 3 derniers mois, avec une marge. Rien n’est enregistré avant validation.
              Retirez une ligne pour la laisser de côté.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {proposals?.map((proposal) => {
              const current = budgets.find((budget) => budget.categoryId === proposal.categoryId)
              return (
                <div
                  key={proposal.categoryId}
                  className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <CategoryBadge categoryId={proposal.categoryId} />
                      <span className="text-sm font-medium tabular-nums">
                        {formatAmount(proposal.monthlyLimit)}
                      </span>
                      {current ? (
                        <span className="text-xs text-muted-foreground">
                          actuel {formatAmount(current.monthlyLimit)}
                        </span>
                      ) : null}
                    </div>
                    {proposal.reason ? (
                      <p className="text-xs text-muted-foreground">{proposal.reason}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() =>
                      setProposals((currentProposals) =>
                        currentProposals
                          ? currentProposals.filter((item) => item.categoryId !== proposal.categoryId)
                          : currentProposals,
                      )
                    }
                  >
                    Retirer
                  </Button>
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposals(null)} disabled={applyingProposals}>
              Annuler
            </Button>
            <Button
              onClick={() => void applyProposals()}
              disabled={applyingProposals || (proposals?.length ?? 0) === 0}
            >
              {applyingProposals
                ? 'Application…'
                : `Appliquer ${proposals?.length ?? 0} plafond${(proposals?.length ?? 0) > 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
