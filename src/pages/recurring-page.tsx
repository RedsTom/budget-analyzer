import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Check,
  ChevronRight,
  Pencil,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoryBadge } from '@/components/category-badge'
import { MerchantDialog } from '@/components/merchant-dialog'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import {
  formatAmount,
  formatDate,
  formatPercent,
  formatSignedAmount,
} from '@/lib/format'
import {
  detectRecurring,
  FREQUENCY_LABELS,
  recurringSummary,
  seriesInRange,
  type RecurrenceFrequency,
  type RecurringSeries,
  type RecurringStatus,
} from '@/lib/recurring'
import { referenceDate } from '@/lib/period'
import { batchAnalyzeRecurring } from '@/lib/ai'
import { aiFailureFromMessage } from '@/lib/ai-errors'
import { guardAiOnline, notifyAiFailure } from '@/lib/ai-notify'
import { useVaultStore } from '@/store/vault-store'
import { useUiStore } from '@/store/ui-store'

type StatusFilter = 'all' | RecurringStatus

const STATUS_RANK: Record<RecurringStatus, number> = {
  pending: 0,
  accepted: 1,
  refused: 2,
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Tous les statuts',
  pending: 'En attente',
  accepted: 'Acceptées',
  refused: 'Refusées',
}

function inStatusScope(
  item: RecurringSeries,
  status: StatusFilter,
  includeInactive: boolean,
): boolean {
  // Les refusées ne sont visibles que sur demande explicite du filtre.
  if (status === 'refused') return item.decision === 'refused'
  if (!includeInactive && !item.active) return false
  if (status === 'all') return item.decision !== 'refused'
  return item.decision === status
}

export function RecurringPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const setRecurringDecision = useVaultStore((state) => state.setRecurringDecision)
  const includeInactive = useUiStore((state) => state.includeInactiveRecurring)
  const setIncludeInactive = useUiStore((state) => state.setIncludeInactiveRecurring)
  const openDetail = useUiStore((state) => state.openDetail)
  const { range } = usePeriod()

  const [direction, setDirection] = useState<'expense' | 'income'>('expense')
  const [search, setSearch] = useState('')
  const [frequency, setFrequency] = useState<'all' | RecurrenceFrequency>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [editing, setEditing] = useState<RecurringSeries | null>(null)

  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const batchSetRecurringDecisions = useVaultStore((state) => state.batchSetRecurringDecisions)

  const [aiProcessing, setAiProcessing] = useState(false)

  const allSeries = useMemo(
    () =>
      detectRecurring(transactions, {
        reference: referenceDate(transactions),
        decisions: recurringDecisions,
        aliases,
      }),
    [transactions, recurringDecisions, aliases],
  )

  // La détection reste globale ; la période filtre les séries affichées.
  const series = useMemo(() => seriesInRange(allSeries, range), [allSeries, range])

  const summary = useMemo(() => recurringSummary(series), [series])

  const statusCounts = useMemo(() => {
    const scoped = includeInactive ? series : series.filter((item) => item.active)
    return {
      pending: scoped.filter((item) => item.decision === 'pending').length,
      accepted: scoped.filter((item) => item.decision === 'accepted').length,
      refused: series.filter((item) => item.decision === 'refused').length,
    }
  }, [series, includeInactive])

  const counts = useMemo(
    () => ({
      expense: series.filter(
        (item) =>
          item.direction === 'expense' &&
          inStatusScope(item, status, includeInactive),
      ).length,
      income: series.filter(
        (item) =>
          item.direction === 'income' &&
          inStatusScope(item, status, includeInactive),
      ).length,
    }),
    [series, includeInactive, status],
  )

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr-FR')
    return series
      .filter((item) => item.direction === direction)
      .filter((item) => inStatusScope(item, status, includeInactive))
      .filter((item) => frequency === 'all' || item.frequency === frequency)
      .filter(
        (item) =>
          !query ||
          item.label.toLocaleLowerCase('fr-FR').includes(query) ||
          item.merchantKey.toLocaleLowerCase('fr-FR').includes(query),
      )
      .sort(
        (a, b) =>
          STATUS_RANK[a.decision] - STATUS_RANK[b.decision] ||
          Number(!a.active) - Number(!b.active) ||
          b.monthlyAmount - a.monthlyAmount,
      )
  }, [series, direction, includeInactive, status, frequency, search])

  // Batch de vote IA sur les séries en attente
  const pendingVisible = visible.filter((item) => item.decision === 'pending')

  async function handleAiSuggestions() {
    if (!aiEnabled || !aiApiKey || aiProcessing) return
    if (pendingVisible.length === 0) {
      toast.info("Aucune série en attente pour l'analyse IA")
      return
    }
    if (!guardAiOnline(() => void handleAiSuggestions())) return

    setAiProcessing(true)
    try {
      // Préparer les items batch à partir des séries en attente
      const items = pendingVisible.map((item) => ({
        id: item.id,
        merchantName: item.label,
        amount: item.averageAmount,
        intervalDays: item.intervalDays,
      }))

      // Lancer le batch IA (classification accept/refuser)
      const results = await batchAnalyzeRecurring(items, aiApiKey)
      if (!results.ok) {
        notifyAiFailure(
          results.failure ?? aiFailureFromMessage(results.error),
          () => void handleAiSuggestions(),
        )
        toast.error('Analyse impossible', { description: results.error })
        return
      }

      const decisions = results.value.reduce<Record<string, 'accepted' | 'refused'>>(
        (acc, entry) => {
          acc[entry.id] = entry.decision
          return acc
        },
        {},
      )

      if (Object.keys(decisions).length === 0) {
        toast.info('Aucune décision exploitable renvoyée par l’IA.')
        return
      }

      // Appliquer les décisions sur le store
      await batchSetRecurringDecisions(decisions)
      toast.success(
        `${Object.keys(decisions).length} série${Object.keys(decisions).length > 1 ? 's' : ''} classée${Object.keys(decisions).length > 1 ? 's' : ''} par l’IA`,
      )
    } catch (error) {
      toast.error('Erreur IA', {
        description: error instanceof Error ? error.message : 'Inconnue',
      })
    } finally {
      setAiProcessing(false)
    }
  }

  async function decide(item: RecurringSeries, decision: 'accepted' | 'refused' | null) {
    try {
      await setRecurringDecision(item.id, decision)
      toast.success(
        decision === 'accepted'
          ? 'Série acceptée'
          : decision === 'refused'
            ? 'Série refusée'
            : 'Série remise en attente',
        {
          description:
            decision === 'accepted'
              ? `${item.label} compte désormais dans les totaux et les échéances.`
              : decision === 'refused'
                ? `${item.label} est exclue des totaux et des échéances.`
                : `${item.label} doit être validée à nouveau.`,
        },
      )
    } catch {
      toast.error('Impossible de modifier cette série')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Récurrences"
        description="Paiements et revenus détectés automatiquement sur la période sélectionnée : abonnements, loyers, salaires, virements réguliers."
        actions={
          <>
            {summary.pendingCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start sm:self-auto"
                onClick={() => setStatus('pending')}
              >
                Examiner
              </Button>
            ) : null}
            {aiEnabled && aiApiKey ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={handleAiSuggestions}
                disabled={aiProcessing}
                title="Analyser les séries en attente par IA"
              >
                <Sparkles className="size-3.5" />
                {aiProcessing ? 'Analyse…' : 'Suggestions IA'}
              </Button>
            ) : null}
            <Badge variant="outline" className="gap-1">
              <Repeat className="size-3" />
              {counts.expense + counts.income} série
              {counts.expense + counts.income > 1 ? 's' : ''}{' '}
              {includeInactive ? 'affichée' : 'active'}
              {counts.expense + counts.income > 1 || includeInactive ? 's' : ''}
            </Badge>
          </>
        }
      />

      {summary.pendingCount > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium">
                  {summary.pendingCount} série{summary.pendingCount > 1 ? 's' : ''} en attente
                  de validation
                </p>
                <p className="text-xs text-muted-foreground">
                  Tant qu’elles ne sont pas acceptées, elles ne comptent ni dans les totaux
                  ni dans les prochaines échéances.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="self-start sm:self-auto"
              onClick={() => setStatus('pending')}
            >
              Examiner
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Dépenses récurrentes / mois"
          value={formatAmount(summary.monthlyExpenses)}
          hint={`${summary.expenseCount} série${summary.expenseCount > 1 ? 's' : ''} active${
            summary.expenseCount > 1 ? 's' : ''
          } acceptée${summary.expenseCount > 1 ? 's' : ''}`}
          icon={<ArrowDownRight className="size-3.5" />}
          accent="expense"
        />
        <StatCard
          label="Entrées récurrentes / mois"
          value={formatAmount(summary.monthlyIncome)}
          hint={`${summary.incomeCount} série${summary.incomeCount > 1 ? 's' : ''} active${
            summary.incomeCount > 1 ? 's' : ''
          } acceptée${summary.incomeCount > 1 ? 's' : ''}`}
          icon={<ArrowUpRight className="size-3.5" />}
          accent="income"
        />
        <StatCard
          label="Net récurrent / mois"
          value={formatSignedAmount(summary.monthlyNet)}
          hint="hors séries en attente, refusées et terminées"
          icon={<Repeat className="size-3.5" />}
        />
        <StatCard
          label="Échéances sous 30 jours"
          value={`${summary.upcoming30}`}
          hint={`${formatAmount(summary.upcomingAmount)} à venir`}
          icon={<BellRing className="size-3.5" />}
        />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Détection</CardTitle>
                <CardDescription>
                  Une série est retenue si les dates sont régulières et les montants
                  stables. Elle ne compte qu’après validation.
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <Tabs
                value={direction}
                onValueChange={(value) => setDirection(value as 'expense' | 'income')}
              >
                <TabsList>
                  <TabsTrigger value="expense">Dépenses ({counts.expense})</TabsTrigger>
                  <TabsTrigger value="income">Entrées ({counts.income})</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Rechercher une série…"
                    className="pl-8"
                  />
                </div>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as StatusFilter)}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{STATUS_LABELS.all}</SelectItem>
                    <SelectItem value="pending">
                      En attente ({statusCounts.pending})
                    </SelectItem>
                    <SelectItem value="accepted">
                      Acceptées ({statusCounts.accepted})
                    </SelectItem>
                    <SelectItem value="refused">
                      Refusées ({statusCounts.refused})
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={frequency}
                  onValueChange={(value) => setFrequency(value as typeof frequency)}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes fréquences</SelectItem>
                    {Object.entries(FREQUENCY_LABELS).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-inactive"
                checked={includeInactive}
                onCheckedChange={(checked) => setIncludeInactive(checked === true)}
              />
              <Label htmlFor="include-inactive" className="text-xs text-muted-foreground">
                Afficher les séries refusées et terminées
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="divide-y border-t">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Aucune série détectée avec ces critères.
              </p>
            ) : (
              visible.map((item) => (
                <SeriesRow
                  key={item.id}
                  item={item}
                  onOpen={() => openDetail({ kind: 'recurring', id: item.id })}
                  onEdit={() => setEditing(item)}
                  onDecide={(decision) => void decide(item, decision)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <MerchantDialog
        key={editing?.id ?? 'closed'}
        merchantKey={editing?.merchantKey ?? null}
        initialLabel={editing?.label ?? ''}
        initialCategoryId={editing?.categoryId ?? 'autres'}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function SeriesRow({
  item,
  onOpen,
  onEdit,
  onDecide,
}: {
  item: RecurringSeries
  onOpen: () => void
  onEdit: () => void
  onDecide: (decision: 'accepted' | 'refused' | null) => void
}) {
  const confidenceTone =
    item.confidence >= 0.85
      ? 'bg-emerald-500'
      : item.confidence >= 0.7
        ? 'bg-amber-500'
        : 'bg-rose-500'

  return (
    <div
      onClick={onOpen}
      className={`flex cursor-pointer flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/40 md:flex-row md:items-center ${
        item.decision === 'refused' ? 'opacity-55' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
            item.direction === 'income'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
          }`}
        >
          {item.direction === 'income' ? (
            <ArrowUpRight className="size-4" />
          ) : (
            <ArrowDownRight className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{item.label}</p>
            <Badge variant="outline">{FREQUENCY_LABELS[item.frequency]}</Badge>
            <CategoryBadge categoryId={item.categoryId} />
            {item.decision === 'pending' ? (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-700 dark:text-amber-400"
              >
                En attente
              </Badge>
            ) : null}
            {item.decision === 'accepted' ? (
              <Badge
                variant="outline"
                className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
              >
                Acceptée
              </Badge>
            ) : null}
            {item.decision === 'refused' ? (
              <Badge variant="secondary">Refusée</Badge>
            ) : null}
            {!item.active ? <Badge variant="secondary">Terminée</Badge> : null}
            {item.active && item.overdue ? <Badge variant="destructive">En retard</Badge> : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {item.occurrences} occurrences · {formatDate(item.dates[0])} →{' '}
            {formatDate(item.lastDate)} · tous les {item.intervalDays} j
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${confidenceTone}`}
                style={{ width: `${Math.round(item.confidence * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              confiance {formatPercent(item.confidence)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-5 md:justify-end">
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Montant moyen</p>
          <p className="font-medium tabular-nums">{formatAmount(item.averageAmount)}</p>
          <p className="text-[11px] text-muted-foreground">
            ≈ {formatAmount(item.monthlyAmount)} / mois
          </p>
        </div>
        <div className="w-28 text-right">
          <p className="text-[11px] text-muted-foreground">Prochaine</p>
          <p className="text-sm font-medium">
            {!item.active
              ? '—'
              : item.overdue
                ? 'dépassée'
                : item.daysUntilNext === 0
                  ? 'aujourd’hui'
                  : `dans ${item.daysUntilNext} j`}
          </p>
          <p className="text-[11px] text-muted-foreground">{formatDate(item.nextDate)}</p>
        </div>
        <div
          className="flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {item.decision === 'pending' ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Accepter la série"
                className="size-10 text-emerald-600 hover:text-emerald-700 md:size-7 dark:text-emerald-400"
                onClick={() => onDecide('accepted')}
              >
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refuser la série"
                className="size-10 text-rose-600 hover:text-rose-700 md:size-7 dark:text-rose-400"
                onClick={() => onDecide('refused')}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-10 md:size-7"
              aria-label="Remettre en attente"
              onClick={() => onDecide(null)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-10 md:size-7"
            aria-label="Modifier le marchand"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-10 md:size-7"
            aria-label="Voir les paiements associés"
            onClick={onOpen}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
