import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Repeat, Timer, Wallet } from 'lucide-react'
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
import { BalanceTimeline } from '@/components/balance-timeline'
import { CategoryBadge } from '@/components/category-badge'
import { AiInsightCard } from '@/components/ai-insight-card'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import { askAssistant } from '@/lib/ai'
import {
  categoryBreakdown,
  percentChange,
  totalsForRange,
  transactionsInRange,
} from '@/lib/analytics'
import { buildAssistantContext } from '@/lib/assistant-context'
import {
  formatAmount,
  formatCount,
  formatDate,
  formatPercent,
  formatSignedAmount,
} from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import { datasetRange, referenceDate } from '@/lib/period'
import { detectRecurring, recurringSummary } from '@/lib/recurring'
import { balanceAt, balancePoints, runwayProjection } from '@/lib/runway'
import { navigate } from '@/lib/router'
import { useVaultStore } from '@/store/vault-store'
import { useUiStore } from '@/store/ui-store'

export function OverviewPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const budgets = useVaultStore((state) => state.budgets)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const { range, previous, label } = usePeriod()
  const focusMerchant = useUiStore((state) => state.focusMerchant)

  const points = useMemo(() => balancePoints(transactions), [transactions])
  const totals = useMemo(() => totalsForRange(transactions, range), [transactions, range])
  const previousTotals = useMemo(
    () => totalsForRange(transactions, previous),
    [transactions, previous],
  )
  const balance = useMemo(() => balanceAt(transactions, range.end), [transactions, range.end])
  const projection = useMemo(() => runwayProjection(transactions), [transactions])
  const recurring = useMemo(
    () =>
      detectRecurring(transactions, {
        reference: referenceDate(transactions),
        decisions: recurringDecisions,
        aliases,
      }),
    [transactions, recurringDecisions, aliases],
  )
  const recurringStats = useMemo(() => recurringSummary(recurring), [recurring])
  const upcoming = useMemo(
    () =>
      recurring
        .filter(
          (item) => item.decision === 'accepted' && item.active && item.daysUntilNext >= 0,
        )
        .sort((a, b) => a.daysUntilNext - b.daysUntilNext)
        .slice(0, 4),
    [recurring],
  )
  const recent = useMemo(
    () => [...transactionsInRange(transactions, range)].reverse().slice(0, 6),
    [transactions, range],
  )
  const topCategories = useMemo(
    () => categoryBreakdown(transactions, range, aliases, 'expense').slice(0, 5),
    [transactions, range, aliases],
  )

  const bounds = datasetRange(transactions)

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue d’ensemble"
        description={`${label} · ${formatCount(totals.count)} mouvement${
          totals.count > 1 ? 's' : ''
        } · historique complet du ${formatDate(bounds.start)} au ${formatDate(bounds.end)}`}
        actions={
          <Badge variant="outline" className="gap-1">
            <Wallet className="size-3" />
            Solde {formatAmount(balance)}
          </Badge>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Solde fin de période"
          value={formatAmount(balance)}
          hint={`${formatCount(totals.count)} mouvements`}
          icon={<Wallet className="size-3.5" />}
        />
        <StatCard
          label="Entrées"
          value={formatAmount(totals.income)}
          delta={percentChange(totals.income, previousTotals.income)}
          hint={`${formatCount(totals.incomeCount)} crédits`}
          icon={<ArrowUpRight className="size-3.5" />}
          accent="income"
        />
        <StatCard
          label="Dépenses"
          value={formatAmount(totals.expenses)}
          delta={percentChange(totals.expenses, previousTotals.expenses)}
          goodWhenUp={false}
          hint={`${formatCount(totals.expenseCount)} débits`}
          icon={<ArrowDownRight className="size-3.5" />}
          accent="expense"
        />
        <StatCard
          label="Net de la période"
          value={formatSignedAmount(totals.net)}
          deltaAmount={totals.net - previousTotals.net}
          hint={
            totals.savingsRate === null
              ? 'aucune entrée sur la période'
              : `taux d’épargne ${formatPercent(totals.savingsRate)}`
          }
          icon={<Timer className="size-3.5" />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Évolution du solde</CardTitle>
            <CardDescription>
              Solde bancaire jour par jour sur la période sélectionnée ({label}).
            </CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => navigate('transactions')}>
                Voir les mouvements
                <ChevronRight className="size-3.5" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <BalanceTimeline points={points} range={range} height={260} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-4 text-muted-foreground" />
              Récurrences
            </CardTitle>
            <CardDescription>
              {recurringStats.expenseCount + recurringStats.incomeCount} série
              {recurringStats.expenseCount + recurringStats.incomeCount > 1 ? 's' : ''}{' '}
              active
              {recurringStats.expenseCount + recurringStats.incomeCount > 1 ? 's' : ''}{' '}
              acceptée
              {recurringStats.expenseCount + recurringStats.incomeCount > 1 ? 's' : ''}
              {recurringStats.pendingCount > 0
                ? ` · ${recurringStats.pendingCount} en attente`
                : ''}
            </CardDescription>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Voir les récurrences"
                onClick={() => navigate('recurring')}
              >
                <ChevronRight className="size-4" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {recurringStats.pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => navigate('recurring')}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left text-xs transition-colors hover:bg-amber-500/10"
              >
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {recurringStats.pendingCount} série
                  {recurringStats.pendingCount > 1 ? 's' : ''} en attente de validation
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
              </button>
            ) : null}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-[11px] text-muted-foreground">Sorties / mois</p>
                <p className="truncate text-sm font-semibold tabular-nums">
                  {formatAmount(recurringStats.monthlyExpenses)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-[11px] text-muted-foreground">Entrées / mois</p>
                <p className="truncate text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatAmount(recurringStats.monthlyIncome)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-[11px] text-muted-foreground">Net / mois</p>
                <p
                  className={`truncate text-sm font-semibold tabular-nums ${
                    recurringStats.monthlyNet >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatSignedAmount(recurringStats.monthlyNet)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Prochaines échéances</p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune échéance dans les 30 prochains jours.
                </p>
              ) : (
                upcoming.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.daysUntilNext === 0
                          ? 'aujourd’hui'
                          : `dans ${item.daysUntilNext} j`}{' '}
                        · {formatDate(item.nextDate)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        item.direction === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : ''
                      }`}
                    >
                      {item.direction === 'income' ? '+' : '-'}
                      {formatAmount(item.averageAmount)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
              Runway estimé :{' '}
              <span className="font-medium text-foreground">
                {projection.daysLeft === null
                  ? '—'
                  : projection.balance <= 0
                    ? 'solde négatif'
                    : `${Math.round(projection.daysLeft)} jours`}
              </span>{' '}
              au rythme actuel ({formatAmount(projection.averageDailyExpense)} / jour).
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Derniers mouvements</CardTitle>
            <CardDescription>Sur la période sélectionnée</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => navigate('transactions')}>
                Tout voir
                <ChevronRight className="size-3.5" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y border-t">
              {recent.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Aucun mouvement sur cette période.
                </p>
              ) : (
                recent.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="w-16 shrink-0 text-xs text-muted-foreground">
                      {formatDate(transaction.date)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => focusMerchant(transaction.merchantKey)}
                        className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                      >
                        {resolveDisplayName(transaction, aliases)}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">
                        {transaction.rawLabel}
                      </p>
                    </div>
                    <CategoryBadge
                      categoryId={transaction.categoryId}
                      className="hidden sm:inline-flex"
                    />
                    <div
                      className={`w-24 shrink-0 text-right text-sm font-medium tabular-nums ${
                        transaction.amount < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {formatSignedAmount(transaction.amount)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top catégories</CardTitle>
            <CardDescription>Dépenses de la période</CardDescription>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ouvrir les analyses"
                onClick={() => navigate('analysis')}
              >
                <ChevronRight className="size-4" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune dépense catégorisée sur la période.
              </p>
            ) : (
              topCategories.map((slice) => (
                <div key={slice.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: slice.color }}
                      />
                      <span className="truncate">{slice.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatAmount(slice.total)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, slice.share * 100)}%`,
                        backgroundColor: slice.color,
                      }}
                    />
                  </div>
                  <p className="text-right text-[11px] text-muted-foreground">
                    {formatPercent(slice.share)} · {formatCount(slice.count)} opérations
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <AiInsightCard
        key={`${range.start}:${range.end}`}
        title="Synthèse de la période"
        description="Commentaire à la demande. Seuls les totaux de la période sélectionnée sont transmis."
        cta="Synthétiser"
        hint="Obtenez une lecture courte du solde, des dépenses et des récurrences acceptées."
        allowPrompt
        placeholder="Ex : est-ce que je vis au-dessus de mes moyens ?"
        suggestions={['Résumer la période', 'Où part l’argent ?', 'Que surveiller ce mois-ci ?']}
        onRun={(question) =>
          askAssistant(
            aiContext,
            question ?? 'Fais une synthèse courte de la période : solde, dérive et action prioritaire.',
            aiApiKey,
          )
        }
      />
    </div>
  )
}
