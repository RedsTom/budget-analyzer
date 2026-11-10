import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Layers,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Timer,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AiInsightCard } from '@/components/ai-insight-card'
import { BalanceTimeline } from '@/components/balance-timeline'
import { CategoryBadge } from '@/components/category-badge'
import { PageHeader } from '@/components/page-header'
import { SortableHeader } from '@/components/sortable-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import { askAssistant, COVERAGE_ANALYSIS_QUESTION } from '@/lib/ai'
import { buildAssistantContext } from '@/lib/assistant-context'
import { CATEGORIES, categoryById } from '@/lib/categories'
import { formatAmount, formatCount, formatDate } from '@/lib/format'
import {
  balanceChainBreaks,
  balancePoints,
  detailedCoverageSegments,
  runwayProjection,
  type CoveredExpense,
} from '@/lib/runway'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import { useVaultStore } from '@/store/vault-store'

type ExpenseSortKey = 'date' | 'label' | 'category' | 'amount' | 'covered'

/** Dépenses affectées à un crédit, triables par colonne indépendamment des autres crédits. */
function SegmentExpensesTable({
  expenses,
  onReassign,
}: {
  expenses: CoveredExpense[]
  onReassign: (expense: CoveredExpense) => void
}) {
  const [sort, setSort] = useState<SortState<ExpenseSortKey>>({ key: 'date', direction: 'asc' })

  function handleSort(key: ExpenseSortKey, initial: SortDirection) {
    setSort((current) => nextSort(current, key, initial))
  }

  const sorted = useMemo(
    () =>
      sortRows(expenses, sort, {
        date: (expense) => expense.date,
        label: (expense) => expense.displayName || expense.rawLabel,
        category: (expense) => categoryById(expense.categoryId).name,
        amount: (expense) => expense.totalExpenseAmount,
        covered: (expense) => expense.coveredAmount,
      }),
    [expenses, sort],
  )

  if (expenses.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Aucune dépense n’a encore consommé ce crédit.
      </p>
    )
  }

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader
              label="Date"
              sortKey="date"
              sort={sort}
              onSort={handleSort}
              className="w-24"
            />
            <SortableHeader
              label="Libellé / Marchand"
              sortKey="label"
              sort={sort}
              onSort={handleSort}
            />
            <SortableHeader
              label="Catégorie"
              sortKey="category"
              sort={sort}
              onSort={handleSort}
            />
            <SortableHeader
              label="Montant dépense"
              sortKey="amount"
              sort={sort}
              onSort={handleSort}
              align="right"
              initialDirection="desc"
            />
            <SortableHeader
              label="Part couverte"
              sortKey="covered"
              sort={sort}
              onSort={handleSort}
              align="right"
              initialDirection="desc"
            />
            <TableHead className="w-24 text-right">Affectation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((expense) => (
            <TableRow key={expense.transactionId} className="text-xs">
              <TableCell className="font-mono text-muted-foreground">
                {formatDate(expense.date)}
              </TableCell>
              <TableCell className="font-medium text-foreground">
                {expense.displayName || expense.rawLabel}
              </TableCell>
              <TableCell>
                <CategoryBadge categoryId={expense.categoryId} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatAmount(expense.totalExpenseAmount)}
              </TableCell>
              <TableCell className="text-right font-semibold text-foreground">
                {formatAmount(expense.coveredAmount)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {expense.isCustom ? (
                    <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                      Manuelle
                    </Badge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReassign(expense)}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    title="Changer l'affectation de cette dépense"
                  >
                    <ArrowRightLeft className="size-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function CoveragePage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const budgets = useVaultStore((state) => state.budgets)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const setCustomAllocation = useVaultStore((state) => state.setCustomAllocation)
  const deleteCustomAllocation = useVaultStore((state) => state.deleteCustomAllocation)
  const clearCustomAllocations = useVaultStore((state) => state.clearCustomAllocations)
  const { range, previous, label } = usePeriod()

  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'exhausted'>('all')
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'amount-desc' | 'amount-asc'>(
    'recent',
  )
  const [search, setSearch] = useState('')
  const [expandedCredits, setExpandedCredits] = useState<Record<string, boolean>>({})

  // Dialogue de réaffectation d'une dépense
  const [reassignModal, setReassignModal] = useState<{
    open: boolean
    expense: CoveredExpense | null
    currentCreditId: string | null
    selectedCreditId: string
  }>({
    open: false,
    expense: null,
    currentCreditId: null,
    selectedCreditId: '',
  })

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

  const points = useMemo(() => balancePoints(transactions), [transactions])
  const projection = useMemo(() => runwayProjection(transactions), [transactions])
  const breaks = useMemo(() => balanceChainBreaks(transactions), [transactions])

  const segments = useMemo(
    () => detailedCoverageSegments(transactions, customAllocations, aliases),
    [transactions, customAllocations, aliases],
  )

  const active = useMemo(
    () => segments.filter((segment) => !segment.exhausted && segment.remaining > 0.005),
    [segments],
  )
  const activeRemaining = active.reduce((total, segment) => total + segment.remaining, 0)

  // Filtrage des crédits
  const filteredSegments = useMemo(() => {
    let list = segments
    if (filterMode === 'active') {
      list = list.filter((s) => !s.exhausted && s.remaining > 0.005)
    } else if (filterMode === 'exhausted') {
      list = list.filter((s) => s.exhausted || s.remaining <= 0.005)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.creditTransaction.rawLabel.toLowerCase().includes(q) ||
          formatAmount(s.amount).includes(q) ||
          s.date.includes(q),
      )
    }

    const sorted = [...list]
    switch (sortMode) {
      case 'oldest':
        sorted.sort(
          (a, b) => a.date.localeCompare(b.date) || a.creditId.localeCompare(b.creditId),
        )
        break
      case 'amount-desc':
        sorted.sort((a, b) => b.amount - a.amount)
        break
      case 'amount-asc':
        sorted.sort((a, b) => a.amount - b.amount)
        break
      case 'recent':
      default:
        sorted.sort(
          (a, b) => b.date.localeCompare(a.date) || b.creditId.localeCompare(a.creditId),
        )
    }
    return sorted
  }, [segments, filterMode, sortMode, search])

  const categoryMap = useMemo(
    () =>
      new Map<string, (typeof CATEGORIES)[number]>(
        CATEGORIES.map((c) => [c.id, c] as [string, (typeof CATEGORIES)[number]]),
      ),
    [],
  )

  const customAllocCount = Object.keys(customAllocations).length

  function toggleExpand(creditId: string) {
    setExpandedCredits((prev) => ({ ...prev, [creditId]: !prev[creditId] }))
  }

  function handleOpenReassign(expense: CoveredExpense, currentCreditId: string) {
    const isCustom = customAllocations[expense.transactionId]
    setReassignModal({
      open: true,
      expense,
      currentCreditId,
      selectedCreditId: isCustom ?? currentCreditId,
    })
  }

  async function handleConfirmReassign() {
    if (!reassignModal.expense) return
    const expenseId = reassignModal.expense.transactionId
    const targetCreditId = reassignModal.selectedCreditId

    try {
      if (targetCreditId === 'auto') {
        await deleteCustomAllocation(expenseId)
        toast.success('Affectation remise en mode automatique (FIFO)')
      } else {
        await setCustomAllocation(expenseId, targetCreditId)
        toast.success('Dépense réaffectée au revenu sélectionné')
      }
      setReassignModal({ open: false, expense: null, currentCreditId: null, selectedCreditId: '' })
    } catch {
      toast.error('Erreur lors de la réaffectation')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couverture & Runway"
        description="Analysez en détail comment chaque revenu a été dépensé, et pilotez manuellement les affectations entre dépenses et revenus."
        actions={
          <div className="flex items-center gap-2">
            {customAllocCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void clearCustomAllocations()
                  toast.success('Toutes les affectations personnalisées ont été réinitialisées')
                }}
                className="text-xs"
              >
                <RotateCcw className="mr-1 size-3" />
                Réinitialiser ({customAllocCount} manuelle{customAllocCount > 1 ? 's' : ''})
              </Button>
            ) : null}
            <Badge variant="outline" className="gap-1">
              <Layers className="size-3" />
              {formatCount(segments.length)} revenus suivis
            </Badge>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Solde actuel"
          value={formatAmount(projection.balance)}
          hint="dernier solde bancaire connu"
          icon={<Wallet className="size-3.5" />}
        />
        <StatCard
          label="Runway estimé"
          value={
            projection.daysLeft === null
              ? '—'
              : projection.balance <= 0
                ? 'solde négatif'
                : `${Math.round(projection.daysLeft)} jours`
          }
          hint={
            projection.balance <= 0
              ? 'le solde est à découvert'
              : projection.endsOn
                ? `jusqu’au ${formatDate(projection.endsOn)}`
                : 'aucune dépense récente'
          }
          icon={<Timer className="size-3.5" />}
        />
        <StatCard
          label="Dépense moyenne / jour"
          value={formatAmount(projection.averageDailyExpense)}
          hint={`fenêtre de ${projection.windowDays} jours`}
          icon={<ArrowDownRight className="size-3.5" />}
          accent="expense"
        />
        <StatCard
          label="Fonds actifs disponibles"
          value={formatAmount(activeRemaining)}
          hint={`${active.length} revenus financent actuellement le budget`}
          icon={<Layers className="size-3.5" />}
          accent="income"
        />
      </section>

      <AiInsightCard
        title="Conseil trésorerie"
        description="Lecture du runway et de la couverture. Seuls les agrégats sont transmis."
        cta="Conseiller"
        hint="Estimez la durée de votre solde et les revenus qui portent encore des dépenses."
        allowPrompt
        placeholder="Ex : combien de jours avant le découvert ?"
        suggestions={['Combien de temps tient mon solde ?', 'Quelle marge de sécurité ?']}
        onRun={(question) => askAssistant(aiContext, question ?? COVERAGE_ANALYSIS_QUESTION, aiApiKey)}
      />

      {breaks.length > 0 ? (
        <Alert variant="destructive">
          <TrendingDown />
          <AlertTitle>Chaîne des soldes incohérente</AlertTitle>
          <AlertDescription>
            {breaks.length} rupture(s) détectée(s). Réimportez l'historique complet pour recalculer la timeline.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline de solde</CardTitle>
          <CardDescription>
            Historique continu de votre solde selon l'ordre du grand livre bancaire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BalanceTimeline points={points} range={range} height={280} />
        </CardContent>
      </Card>

      {/* Section interactive de couverture des revenus */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Ventilation des revenus & Dépenses couvertes</CardTitle>
            <CardDescription>
              Découvrez la répartition par catégorie financée par chaque entrée et personnalisez les affectations.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filtrer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex rounded-lg border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMode === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'
                }`}
              >
                Tous ({segments.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('active')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMode === 'active' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'
                }`}
              >
                Actifs ({active.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('exhausted')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMode === 'exhausted' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'
                }`}
              >
                Épuisés ({segments.length - active.length})
              </button>
            </div>
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as typeof sortMode)}
            >
              <SelectTrigger size="sm" className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Plus récents</SelectItem>
                <SelectItem value="oldest">Plus anciens</SelectItem>
                <SelectItem value="amount-desc">Montant décroissant</SelectItem>
                <SelectItem value="amount-asc">Montant croissant</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {filteredSegments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucun revenu ne correspond aux critères.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredSegments.map((segment) => {
                const isExpanded = Boolean(expandedCredits[segment.creditId])
                const pctUsed = segment.amount > 0 ? Math.min(100, Math.round((segment.coveredAmount / segment.amount) * 100)) : 100
                const categoriesList = Object.entries(segment.categoryTotals)
                  .sort((a, b) => b[1] - a[1])

                return (
                  <div
                    key={segment.creditId}
                    className="overflow-hidden rounded-xl border bg-card transition-all hover:border-primary/40"
                  >
                    {/* En-tête du segment de crédit */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpand(segment.creditId)}
                      onKeyDown={(e) => e.key === 'Enter' && toggleExpand(segment.creditId)}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between cursor-pointer hover:bg-muted/30 select-none"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{segment.displayName}</span>
                          <Badge
                            variant={segment.exhausted ? 'outline' : 'secondary'}
                            className={
                              segment.exhausted
                                ? 'text-muted-foreground text-[10px]'
                                : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[10px]'
                            }
                          >
                            {segment.exhausted ? 'Épuisé' : 'Fonds actifs'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">· {formatDate(segment.date)}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            Couverture :{' '}
                            <strong className="text-foreground">
                              {segment.durationDays} jour{segment.durationDays > 1 ? 's' : ''}
                            </strong>
                            {segment.coversUntil ? ` (jusqu’au ${formatDate(segment.coversUntil)})` : ''}
                          </span>
                          <span>•</span>
                          <span>
                            {segment.expenses.length} dépense{segment.expenses.length > 1 ? 's' : ''} financée{segment.expenses.length > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Montants et progression */}
                      <div className="flex items-center gap-5">
                        <div className="w-36 sm:w-44 space-y-1.5 text-right">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">{formatAmount(segment.amount)}</span>
                            <span className="text-[11px] text-muted-foreground">{pctUsed} %</span>
                          </div>
                          <Progress value={pctUsed} className="h-1.5" />
                          <div className="text-[11px] text-muted-foreground">
                            {segment.remaining > 0.005 ? (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                Reste {formatAmount(segment.remaining)}
                              </span>
                            ) : (
                              'Totalement consommé'
                            )}
                          </div>
                        </div>

                        <Button variant="ghost" size="icon" className="size-8">
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </Button>
                      </div>
                    </div>

                    {/* Zone dépliée : Catégories financées & Dépenses individuelles */}
                    {isExpanded ? (
                      <div className="border-t bg-muted/10 p-4 space-y-5 animate-in fade-in-50 duration-150">
                        {/* Répartition par catégorie */}
                        {categoriesList.length > 0 ? (
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Répartition des dépenses financées
                            </h4>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                              {categoriesList.map(([catId, amount]) => {
                                const cat = categoryMap.get(catId)
                                const share = segment.coveredAmount > 0 ? Math.round((amount / segment.coveredAmount) * 100) : 0
                                return (
                                  <div
                                    key={catId}
                                    className="flex items-center justify-between rounded-lg border bg-card/60 p-2 text-xs"
                                  >
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span
                                        className="size-2 rounded-full shrink-0"
                                        style={{ backgroundColor: cat?.color ?? '#94a3b8' }}
                                      />
                                      <span className="truncate">{cat?.name ?? catId}</span>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="font-medium">{formatAmount(amount)}</div>
                                      <div className="text-[10px] text-muted-foreground">{share} %</div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* Liste des opérations financées */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Dépenses affectées ({segment.expenses.length})
                          </h4>

                          <SegmentExpensesTable
                            expenses={segment.expenses}
                            onReassign={(expense) => handleOpenReassign(expense, segment.creditId)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogue de Réaffectation */}
      <Dialog
        open={reassignModal.open}
        onOpenChange={(open) => {
          if (!open) setReassignModal({ open: false, expense: null, currentCreditId: null, selectedCreditId: '' })
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              Affecter cette dépense à un revenu
            </DialogTitle>
            <DialogDescription>
              Choisissez à quel crédit ou revenu vous souhaitez rattacher le financement de cette dépense.
            </DialogDescription>
          </DialogHeader>

          {reassignModal.expense ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dépense :</span>
                  <span className="font-semibold text-foreground">{reassignModal.expense.displayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date :</span>
                  <span>{formatDate(reassignModal.expense.date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Montant total :</span>
                  <span className="font-semibold">{formatAmount(reassignModal.expense.totalExpenseAmount)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="credit-select">Revenu de rattachement</Label>
                <Select
                  value={reassignModal.selectedCreditId}
                  onValueChange={(val) =>
                    setReassignModal((prev) => ({ ...prev, selectedCreditId: val }))
                  }
                >
                  <SelectTrigger id="credit-select">
                    <SelectValue placeholder="Sélectionnez un revenu..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="auto">
                      Automatique (FIFO chronologique par défaut)
                    </SelectItem>
                    {segments.map((seg) => (
                      <SelectItem key={seg.creditId} value={seg.creditId}>
                        {formatDate(seg.date)} - {seg.displayName} ({formatAmount(seg.amount)})
                        {seg.remaining > 0 ? ` · reste ${formatAmount(seg.remaining)}` : ' · complet'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  En ciblant un revenu, cette dépense sera financée en priorité par ce crédit
                  plutôt que par le défilement temporel automatique.
                </p>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setReassignModal({ open: false, expense: null, currentCreditId: null, selectedCreditId: '' })
              }
            >
              Annuler
            </Button>
            <Button onClick={() => void handleConfirmReassign()}>
              Enregistrer l’affectation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
