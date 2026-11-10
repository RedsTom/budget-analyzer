import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryBadge } from '@/components/category-badge'
import {
  DetailPanel,
  TransactionList,
  type DetailStat,
} from '@/components/detail-panel'
import { summarize } from '@/lib/analytics'
import { categoryIdOf } from '@/lib/categories'
import {
  formatAmount,
  formatCount,
  formatDate,
  formatPercent,
  formatSignedAmount,
} from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import { referenceDate } from '@/lib/period'
import {
  detectRecurring,
  FREQUENCY_LABELS,
  type RecurringSeries,
  type RecurringStatus,
} from '@/lib/recurring'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import type { AliasEntry, RecurringDecision, Transaction } from '@/lib/types'

/** Largeur de la colonne de détail, du tiers à la moitié de la page. */
const PANEL_WIDTH = 'md:w-[20rem] lg:w-[24rem] xl:w-[28rem] 2xl:w-[32rem]'

function newestFirst(items: Transaction[]): Transaction[] {
  return [...items].sort(
    (a, b) => b.date.localeCompare(a.date) || b.order - a.order,
  )
}

function sameMerchant(transactions: Transaction[], merchantKey: string): Transaction[] {
  return newestFirst(
    transactions.filter((transaction) => transaction.merchantKey === merchantKey),
  )
}

function DecisionBadge({ decision }: { decision: RecurringStatus }) {
  if (decision === 'accepted') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
      >
        Acceptée
      </Badge>
    )
  }
  if (decision === 'refused') {
    return <Badge variant="secondary">Refusée</Badge>
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/50 text-amber-700 dark:text-amber-400"
    >
      En attente
    </Badge>
  )
}

export function RecurringDetailPanel({
  series,
  transactions,
  aliases,
  onClose,
  onDecision,
}: {
  series: RecurringSeries
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  onClose: () => void
  onDecision: (decision: RecurringDecision | null) => void
}) {
  const dateSet = useMemo(() => new Set(series.dates), [series])

  const items = useMemo(
    () =>
      newestFirst(
        transactions.filter(
          (transaction) =>
            transaction.merchantKey === series.merchantKey &&
            dateSet.has(transaction.date) &&
            (series.direction === 'income' ? transaction.amount > 0 : transaction.amount < 0),
        ),
      ),
    [transactions, series, dateSet],
  )

  const stats: DetailStat[] = [
    { label: 'Montant moyen', value: formatAmount(series.averageAmount) },
    {
      label: 'Équivalent mensuel',
      value: formatAmount(series.monthlyAmount),
      hint: 'lissé',
    },
    { label: 'Occurrences', value: formatCount(series.occurrences) },
    {
      label: 'Total',
      value: formatAmount(series.totalAmount),
    },
    {
      label: 'Prochaine',
      value: series.active
        ? series.overdue
          ? 'Dépassée'
          : series.daysUntilNext === 0
            ? 'Aujourd’hui'
            : `Dans ${series.daysUntilNext} j`
        : '—',
      hint: series.active ? formatDate(series.nextDate) : 'série terminée',
    },
    {
      label: 'Confiance',
      value: formatPercent(series.confidence),
      hint: `tous les ${series.intervalDays} j`,
    },
  ]

  const sectionLabel =
    series.direction === 'income' ? 'Encaissements associés' : 'Paiements associés'

  return (
    <DetailPanel
      onClose={onClose}
      title={series.label}
      description={`${formatCount(series.occurrences)} occurrences · ${formatDate(
        series.dates[0],
      )} → ${formatDate(series.lastDate)}`}
      badges={
        <>
          <DecisionBadge decision={series.decision} />
          <Badge variant="outline">{FREQUENCY_LABELS[series.frequency]}</Badge>
          <CategoryBadge categoryId={series.categoryId} />
          {!series.active ? <Badge variant="secondary">Terminée</Badge> : null}
          {series.active && series.overdue ? (
            <Badge variant="destructive">En retard</Badge>
          ) : null}
        </>
      }
      stats={stats}
      footer={
        series.decision === 'pending' ? (
          <>
            <Button size="sm" onClick={() => onDecision('accepted')}>
              Accepter la série
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecision('refused')}>
              Refuser
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => onDecision(null)}>
            <RotateCcw className="size-3.5" />
            Remettre en attente
          </Button>
        )
      }
    >
      <section className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {sectionLabel} · {formatCount(items.length)}
        </p>
        <TransactionList
          transactions={items}
          aliases={aliases}
          emptyLabel="Aucune opération rattachée à cette série."
        />
      </section>
    </DetailPanel>
  )
}

export function MerchantDetailPanel({
  merchantKey,
  transactions,
  aliases,
  onClose,
}: {
  merchantKey: string
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  onClose: () => void
}) {
  const focusMerchant = useUiStore((state) => state.focusMerchant)
  const items = useMemo(
    () => sameMerchant(transactions, merchantKey),
    [transactions, merchantKey],
  )
  const totals = useMemo(() => summarize(items), [items])

  const latest = items[0]
  const label = latest ? resolveDisplayName(latest, aliases) : merchantKey
  const categoryId = latest ? categoryIdOf(latest, aliases) : 'autres'
  const first = items[items.length - 1]
  const last = items[0]

  return (
    <DetailPanel
      onClose={onClose}
      title={label}
      description={`${formatCount(totals.count)} opérations · historique complet`}
      badges={
        <>
          <Badge variant="outline">{merchantKey}</Badge>
          <CategoryBadge categoryId={categoryId} />
        </>
      }
      stats={[
        {
          label: 'Opérations',
          value: formatCount(totals.count),
          hint:
            first && last
              ? `${formatDate(first.date)} → ${formatDate(last.date)}`
              : undefined,
        },
        { label: 'Dépenses', value: formatAmount(totals.expenses), tone: 'expense' },
        { label: 'Entrées', value: formatAmount(totals.income), tone: 'income' },
        { label: 'Net', value: formatSignedAmount(totals.net) },
      ]}
      footer={
        <Button size="sm" variant="outline" onClick={() => focusMerchant(merchantKey)}>
          Filtrer la page Transactions
        </Button>
      }
    >
      <section className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Toutes les opérations · {formatCount(items.length)}
        </p>
        <TransactionList
          transactions={items}
          aliases={aliases}
          emptyLabel="Aucune opération pour ce marchand."
        />
      </section>
    </DetailPanel>
  )
}

export function TransactionDetailPanel({
  transactionId,
  transactions,
  aliases,
  onClose,
}: {
  transactionId: string
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  onClose: () => void
}) {
  const focusMerchant = useUiStore((state) => state.focusMerchant)
  const transaction = useMemo(
    () => transactions.find((item) => item.id === transactionId) ?? null,
    [transactions, transactionId],
  )
  const items = useMemo(
    () => (transaction ? sameMerchant(transactions, transaction.merchantKey) : []),
    [transactions, transaction],
  )

  if (!transaction) return null

  const isCredit = transaction.amount >= 0
  const others = items.filter((item) => item.id !== transaction.id)
  const categoryId = categoryIdOf(transaction, aliases)

  return (
    <DetailPanel
      onClose={onClose}
      title={
        <span
          className={cn(
            isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {formatSignedAmount(transaction.amount)}
        </span>
      }
      description={resolveDisplayName(transaction, aliases)}
      badges={
        <>
          <Badge variant="outline">{isCredit ? 'Crédit' : 'Débit'}</Badge>
          <Badge variant="outline">{transaction.merchantKey}</Badge>
          <CategoryBadge categoryId={categoryId} />
        </>
      }
      stats={[
        { label: 'Date', value: formatDate(transaction.date) },
        {
          label: 'Date de valeur',
          value: formatDate(transaction.valueDate),
        },
        {
          label: 'Solde après',
          value: formatAmount(transaction.solde),
          hint: 'après cette opération',
        },
        {
          label: 'Même source',
          value: formatCount(items.length),
          hint: 'opérations',
        },
      ]}
      footer={
        <Button
          size="sm"
          variant="outline"
          onClick={() => focusMerchant(transaction.merchantKey)}
        >
          Filtrer la page Transactions
        </Button>
      }
    >
      <section className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Libellé bancaire</p>
        <p className="rounded-lg bg-muted/60 p-2.5 text-xs break-words text-muted-foreground">
          {transaction.rawLabel}
        </p>
      </section>

      {others.length > 0 ? (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Autres opérations de {transaction.merchantKey} · {formatCount(others.length)}
          </summary>
          <div className="pt-2">
            <TransactionList
              transactions={others}
              aliases={aliases}
              emptyLabel="Aucune autre opération pour cette source."
            />
          </div>
        </details>
      ) : null}
    </DetailPanel>
  )
}

/**
 * Colonne de droite montée dans `AppShell`, à côté de la page : le panneau
 * scinde l'écran au lieu de s'empiler par-dessus. Sa largeur s'anime à
 * l'ouverture et à la fermeture ; la cible est conservée pendant l'animation
 * de sortie puis purgée sur `transitionend`.
 */
export function DetailHost() {
  const detail = useUiStore((state) => state.detail)
  const open = useUiStore((state) => state.detailOpen)
  const closeDetail = useUiStore((state) => state.closeDetail)
  const clearDetail = useUiStore((state) => state.clearDetail)

  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const setRecurringDecision = useVaultStore((state) => state.setRecurringDecision)

  const series = useMemo(
    () =>
      detail?.kind === 'recurring'
        ? detectRecurring(transactions, {
            reference: referenceDate(transactions),
            decisions: recurringDecisions,
            aliases,
          })
        : [],
    [detail?.kind, transactions, recurringDecisions, aliases],
  )

  let content = null
  if (detail?.kind === 'recurring') {
    const current = series.find((item) => item.id === detail.id)
    if (current) {
      content = (
        <RecurringDetailPanel
          series={current}
          transactions={transactions}
          aliases={aliases}
          onClose={closeDetail}
          onDecision={(decision) => void setRecurringDecision(current.id, decision)}
        />
      )
    }
  } else if (detail?.kind === 'merchant') {
    content = (
      <MerchantDetailPanel
        merchantKey={detail.merchantKey}
        transactions={transactions}
        aliases={aliases}
        onClose={closeDetail}
      />
    )
  } else if (detail?.kind === 'transaction') {
    content = (
      <TransactionDetailPanel
        transactionId={detail.id}
        transactions={transactions}
        aliases={aliases}
        onClose={closeDetail}
      />
    )
  }

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.propertyName !== 'width' && event.propertyName !== 'transform') return
        if (!open) clearDetail()
      }}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden bg-background',
        'transition-[width,transform,opacity] duration-300 ease-out',
        'max-md:fixed max-md:inset-0 max-md:z-40 max-md:h-svh max-md:w-full',
        open
          ? 'max-md:translate-x-0 max-md:opacity-100'
          : 'max-md:pointer-events-none max-md:translate-x-full max-md:opacity-0',
        'md:h-full',
        open
          ? cn('md:border-l md:opacity-100', PANEL_WIDTH)
          : 'md:w-0 md:opacity-0',
      )}
    >
      <div className={cn('flex h-full min-h-0 flex-col max-md:w-full', PANEL_WIDTH)}>
        {content}
      </div>
    </aside>
  )
}
