import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  RotateCcw,
  Search,
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
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AiInsightCard } from '@/components/ai-insight-card'
import { BalanceTimeline } from '@/components/balance-timeline'
import { CategoryBadge } from '@/components/category-badge'
import { DataList, DataListRow } from '@/components/data-list'
import { PageHeader } from '@/components/page-header'
import { PaymentAllocationDialog } from '@/components/payment-allocation-dialog'
import { SortableHeader } from '@/components/sortable-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import { askAssistant, COVERAGE_ANALYSIS_QUESTION } from '@/lib/ai'
import { buildAssistantContext } from '@/lib/assistant-context'
import { CATEGORIES, categoryById, categoryIdOf } from '@/lib/categories'
import { formatAmount, formatCount, formatDate } from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import { inRange } from '@/lib/period'
import {
  balanceChainBreaks,
  balancePoints,
  coverageAvailability,
  detailedCoverageSegments,
  paymentAllocationStatuses,
  runwayProjection,
  type CoveredExpense,
  type PaymentAllocationStatus,
} from '@/lib/runway'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import type { AliasEntry } from '@/lib/types'
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
    <>
      <DataList className="rounded-lg border md:hidden">
        {sorted.map((expense) => (
          <DataListRow
            key={expense.transactionId}
            primary={expense.displayName || expense.rawLabel}
            secondary={`${formatDate(expense.date)} · ${categoryById(expense.categoryId).name}`}
            amount={formatAmount(expense.coveredAmount)}
            onClick={() => onReassign(expense)}
            ariaLabel={`Réaffecter ${expense.displayName || expense.rawLabel}`}
          />
        ))}
      </DataList>

      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
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
    </>
  )
}

function PaymentRow({
  payment,
  aliases,
  onOpen,
}: {
  payment: PaymentAllocationStatus
  aliases: Record<string, AliasEntry>
  onOpen: () => void
}) {
  const categoryId = categoryIdOf(payment.transaction, aliases)
  const isTransfer = categoryId === 'transferts'
  const label = resolveDisplayName(payment.transaction, aliases)
  const pct =
    payment.totalAmount > 0
      ? Math.min(100, Math.round((payment.assignedAmount / payment.totalAmount) * 100))
      : 100

  const status =
    payment.status === 'done'
      ? {
          label: 'Traité',
          className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
        }
      : payment.status === 'partial'
        ? {
            label: 'Partiel',
            className: 'border-amber-500/40 text-amber-700 dark:text-amber-400',
          }
        : { label: 'À traiter', className: 'text-muted-foreground' }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="w-20 shrink-0 pt-0.5 text-xs text-muted-foreground">
          {formatDate(payment.transaction.date)}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{label}</span>
          <p className="truncate text-xs text-muted-foreground">
            {payment.transaction.rawLabel}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <CategoryBadge categoryId={categoryId} />
            {isTransfer ? (
              <Badge variant="outline" className="text-[10px]">
                Virement
              </Badge>
            ) : null}
            <Badge variant="outline" className={`text-[10px] ${status.className}`}>
              {status.label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:w-64">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums">
              {formatAmount(payment.totalAmount)}
            </span>
            <span className="text-xs text-muted-foreground">{pct} %</span>
          </div>
          <Progress value={pct} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">
            {payment.status === 'done'
              ? 'Entièrement affecté'
              : payment.assignedAmount > 0.005
                ? `${formatAmount(payment.assignedAmount)} affectés · reste ${formatAmount(payment.remainingAmount)}`
                : 'Aucune affectation'}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  )
}

export function CoveragePage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const budgets = useVaultStore((state) => state.budgets)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const clearCustomAllocations = useVaultStore((state) => state.clearCustomAllocations)
  const { range, previous, label } = usePeriod()

  const [tab, setTab] = useState<'payments' | 'credits'>('payments')
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'exhausted'>('all')
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'amount-desc' | 'amount-asc'>(
    'recent',
  )
  const [search, setSearch] = useState('')
  const [expandedCredits, setExpandedCredits] = useState<Record<string, boolean>>({})
  const [paymentFilter, setPaymentFilter] = useState<
    'todo' | 'partial' | 'done' | 'all'
  >('todo')
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentSort, setPaymentSort] = useState<'oldest' | 'recent' | 'amount'>('recent')
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [paymentPage, setPaymentPage] = useState({ key: '', visible: 40 })

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

  const availability = useMemo(
    () => coverageAvailability(segments, projection.balance),
    [segments, projection.balance],
  )
  const active = useMemo(
    () =>
      segments.filter(
        (segment) => (availability.availableByCredit[segment.creditId] ?? 0) > 0.005,
      ),
    [segments, availability],
  )
  const activeRemaining = availability.available

  const scopedSegments = useMemo(
    () => segments.filter((segment) => inRange(segment.creditTransaction, range)),
    [segments, range],
  )
  const scopedActive = useMemo(
    () =>
      scopedSegments.filter(
        (segment) => (availability.availableByCredit[segment.creditId] ?? 0) > 0.005,
      ),
    [scopedSegments, availability],
  )

  // Filtrage des crédits
  const filteredSegments = useMemo(() => {
    let list = scopedSegments
    if (filterMode === 'active') {
      list = list.filter(
        (segment) => (availability.availableByCredit[segment.creditId] ?? 0) > 0.005,
      )
    } else if (filterMode === 'exhausted') {
      list = list.filter(
        (segment) => (availability.availableByCredit[segment.creditId] ?? 0) <= 0.005,
      )
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
  }, [scopedSegments, availability, filterMode, sortMode, search])

  const categoryMap = useMemo(
    () =>
      new Map<string, (typeof CATEGORIES)[number]>(
        CATEGORIES.map((c) => [c.id, c] as [string, (typeof CATEGORIES)[number]]),
      ),
    [],
  )

  const customAllocCount = Object.keys(customAllocations).length

  const payments = useMemo(
    () =>
      paymentAllocationStatuses(transactions, customAllocations, aliases).filter(
        (payment) => inRange(payment.transaction, range),
      ),
    [transactions, customAllocations, aliases, range],
  )

  const orderedPayments = useMemo(() => {
    const sorted = [...payments]
    if (paymentSort === 'amount') {
      sorted.sort(
        (a, b) =>
          b.totalAmount - a.totalAmount ||
          b.transaction.date.localeCompare(a.transaction.date) ||
          b.transaction.order - a.transaction.order,
      )
      return sorted
    }
    sorted.sort(
      (a, b) =>
        a.transaction.date.localeCompare(b.transaction.date) ||
        a.transaction.order - b.transaction.order,
    )
    return paymentSort === 'oldest' ? sorted : sorted.reverse()
  }, [payments, paymentSort])

  const paymentCounts = useMemo(() => {
    const unassigned = payments.filter((payment) => payment.status === 'todo').length
    const partial = payments.filter((payment) => payment.status === 'partial').length
    const done = payments.filter((payment) => payment.status === 'done').length
    return {
      unassigned,
      partial,
      done,
      pending: unassigned + partial,
      total: payments.length,
    }
  }, [payments])

  const nextPayment = useMemo(
    () => orderedPayments.find((payment) => payment.status !== 'done') ?? null,
    [orderedPayments],
  )

  const filteredPayments = useMemo(() => {
    const query = paymentSearch.trim().toLocaleLowerCase('fr-FR')
    return orderedPayments.filter((payment) => {
      if (paymentFilter === 'todo' && payment.status === 'done') return false
      if (paymentFilter === 'partial' && payment.status !== 'partial') return false
      if (paymentFilter === 'done' && payment.status !== 'done') return false
      if (!query) return true
      const name = payment.transaction.displayName || payment.transaction.rawLabel
      const category = categoryById(categoryIdOf(payment.transaction, aliases)).name
      return (
        name.toLocaleLowerCase('fr-FR').includes(query) ||
        payment.transaction.rawLabel.toLocaleLowerCase('fr-FR').includes(query) ||
        category.toLocaleLowerCase('fr-FR').includes(query) ||
        payment.transaction.date.includes(query) ||
        payment.totalAmount.toFixed(2).includes(query)
      )
    })
  }, [aliases, paymentFilter, paymentSearch, orderedPayments])

  const paymentPageKey = [paymentFilter, paymentSearch, paymentSort].join('|')
  const visiblePayments =
    paymentPage.key === paymentPageKey ? paymentPage.visible : 40

  function toggleExpand(creditId: string) {
    setExpandedCredits((prev) => ({ ...prev, [creditId]: !prev[creditId] }))
  }

  function handlePaymentSaved(advance: boolean) {
    if (!advance) {
      setSelectedPaymentId(null)
      return
    }
    const currentIndex = orderedPayments.findIndex(
      (payment) => payment.transaction.id === selectedPaymentId,
    )
    const next = orderedPayments
      .slice(currentIndex + 1)
      .find(
        (payment) =>
          payment.status !== 'done' &&
          payment.transaction.id !== selectedPaymentId,
      )
    setSelectedPaymentId(next?.transaction.id ?? null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couverture & Runway"
        description="Traitez les paiements de la période sélectionnée un par un et rattachez-les aux revenus proches dans le temps. Aucun paiement n’est classé automatiquement."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {customAllocCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void clearCustomAllocations()
                    .then(() =>
                      toast.success(
                        'Toutes les affectations ont été réinitialisées',
                      ),
                    )
                    .catch(() => toast.error('Réinitialisation impossible'))
                }}
                className="text-xs"
              >
                <RotateCcw className="mr-1 size-3" />
                Réinitialiser ({customAllocCount})
              </Button>
            ) : null}
            <Badge variant="outline" className="gap-1">
              <Layers className="size-3" />
              {formatCount(paymentCounts.pending)} à traiter
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
          hint={
            availability.absorbedDeficit > 0.005
              ? `${active.length} revenu${active.length > 1 ? 's' : ''} · ${formatAmount(
                  availability.absorbedDeficit,
                )} absorbés par le déficit antérieur`
              : `${active.length} revenus financent actuellement le budget`
          }
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

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'payments' | 'credits')}
      >
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="payments">
            Paiements ({formatCount(paymentCounts.pending)})
          </TabsTrigger>
          <TabsTrigger value="credits">
            Revenus ({formatCount(scopedSegments.length)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Traitement des paiements</CardTitle>
              <CardDescription>
                Chaque paiement de la période doit être rattaché à un ou plusieurs
                revenus. Le classement automatique est désactivé.
              </CardDescription>
              <CardAction>
                <Button
                  size="sm"
                  onClick={() => {
                    if (nextPayment) {
                      setSelectedPaymentId(nextPayment.transaction.id)
                    }
                  }}
                  disabled={!nextPayment}
                >
                  <Wallet className="size-3.5" />
                  {paymentCounts.done === 0 ? 'Commencer' : 'Continuer'}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-amber-500/10 p-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Sans affectation
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCount(paymentCounts.unassigned)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 p-2">
                  <p className="text-[11px] text-muted-foreground">Partiels</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCount(paymentCounts.partial)}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-500/10 p-2">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Traités
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCount(paymentCounts.done)}
                  </p>
                </div>
              </div>
              <Progress
                value={
                  paymentCounts.total > 0
                    ? (paymentCounts.done / paymentCounts.total) * 100
                    : 100
                }
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                {formatCount(paymentCounts.done)} sur{' '}
                {formatCount(paymentCounts.total)} paiements traités. Les revenus
                proches du paiement sont proposés en priorité.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3">
                <div>
                  <CardTitle>File de traitement</CardTitle>
                  <CardDescription>
                    Cliquez sur un paiement pour choisir un ou plusieurs revenus.
                  </CardDescription>
                </div>

                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={paymentSearch}
                      onChange={(event) => setPaymentSearch(event.target.value)}
                      placeholder="Rechercher un paiement, une catégorie, un montant…"
                      className="pl-8"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        ['todo', 'À traiter', paymentCounts.pending],
                        ['partial', 'Partiels', paymentCounts.partial],
                        ['done', 'Traités', paymentCounts.done],
                        ['all', 'Tous', paymentCounts.total],
                      ] as const
                    ).map(([id, label, count]) => (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={paymentFilter === id ? 'secondary' : 'ghost'}
                        className="h-8"
                        onClick={() => setPaymentFilter(id)}
                      >
                        {label} ({formatCount(count)})
                      </Button>
                    ))}
                  </div>
                  <Select
                    value={paymentSort}
                    onValueChange={(value) =>
                      setPaymentSort(value as typeof paymentSort)
                    }
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oldest">Plus anciens</SelectItem>
                      <SelectItem value="recent">Plus récents</SelectItem>
                      <SelectItem value="amount">Montant décroissant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {filteredPayments.length === 0 ? (
                <p className="border-t px-4 py-10 text-center text-sm text-muted-foreground">
                  Aucun paiement ne correspond à ces critères.
                </p>
              ) : (
                <div className="divide-y border-t">
                  {filteredPayments
                    .slice(0, visiblePayments)
                    .map((payment) => (
                      <PaymentRow
                        key={payment.transaction.id}
                        payment={payment}
                        aliases={aliases}
                        onOpen={() =>
                          setSelectedPaymentId(payment.transaction.id)
                        }
                      />
                    ))}
                </div>
              )}

              {visiblePayments < filteredPayments.length ? (
                <div className="flex justify-center border-t px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPaymentPage({
                        key: paymentPageKey,
                        visible: visiblePayments + 40,
                      })
                    }
                  >
                    Afficher les 40 paiements suivants
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits" className="mt-4">
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
            <div className="relative w-full sm:w-48">
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
                Tous ({scopedSegments.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('active')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMode === 'active' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'
                }`}
              >
                Actifs ({scopedActive.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('exhausted')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMode === 'exhausted' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'
                }`}
              >
                Épuisés ({scopedSegments.length - scopedActive.length})
              </button>
            </div>
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as typeof sortMode)}
            >
              <SelectTrigger size="sm" className="w-full sm:w-[170px]">
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
              Aucun revenu ne correspond aux critères dans cette période.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredSegments.map((segment) => {
                const isExpanded = Boolean(expandedCredits[segment.creditId])
                const availableRemaining =
                  availability.availableByCredit[segment.creditId] ?? 0
                const deficitAbsorbed =
                  availability.deficitByCredit[segment.creditId] ?? 0
                const displayExhausted = availableRemaining <= 0.005
                const pctUsed =
                  segment.amount > 0
                    ? Math.min(
                        100,
                        Math.round(
                          ((segment.coveredAmount + deficitAbsorbed) / segment.amount) * 100,
                        ),
                      )
                    : 100
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
                            variant={displayExhausted ? 'outline' : 'secondary'}
                            className={
                              displayExhausted
                                ? 'text-muted-foreground text-[10px]'
                                : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[10px]'
                            }
                          >
                            {displayExhausted
                              ? deficitAbsorbed > 0.005
                                ? 'Déficit'
                                : 'Épuisé'
                              : 'Fonds actifs'}
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
                            {availableRemaining > 0.005 ? (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                Reste {formatAmount(availableRemaining)}
                              </span>
                            ) : deficitAbsorbed > 0.005 ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                Absorbé par le déficit
                              </span>
                            ) : (
                              'Totalement consommé'
                            )}
                          </div>
                          {deficitAbsorbed > 0.005 ? (
                            <p className="text-[10px] text-amber-700 dark:text-amber-400">
                              Dont {formatAmount(deficitAbsorbed)} de découvert antérieur
                            </p>
                          ) : null}
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
                            onReassign={(expense) =>
                              setSelectedPaymentId(expense.transactionId)
                            }
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
        </TabsContent>
      </Tabs>

      <PaymentAllocationDialog
        key={selectedPaymentId ?? 'closed'}
        paymentId={selectedPaymentId}
        onClose={() => setSelectedPaymentId(null)}
        onSaved={handlePaymentSaved}
      />
    </div>
  )
}
