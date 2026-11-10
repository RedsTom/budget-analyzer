import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { categoryById, categoryIdOf } from '@/lib/categories'
import {
  formatAmount,
  formatCompactAmount,
  formatDate,
  formatPercent,
  formatSignedAmount,
} from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import type { AssistantArtifact, Transaction } from '@/lib/types'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
}

const DECISION_LABELS: Record<string, string> = {
  accepted: 'Acceptée',
  refused: 'Refusée',
  pending: 'En attente',
}

const DECISION_CLASSES: Record<string, string> = {
  accepted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  refused: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

function Shell({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card/60">
      <div className="flex items-baseline justify-between gap-3 border-b px-3 py-2">
        <p className="truncate text-xs font-medium">{title}</p>
        {meta ? <p className="shrink-0 text-[11px] text-muted-foreground">{meta}</p> : null}
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>
}

function Amount({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span
      className={`shrink-0 font-medium tabular-nums ${
        value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
      } ${className}`}
    >
      {formatSignedAmount(value)}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Opérations                                                                 */
/* -------------------------------------------------------------------------- */

function TransactionsArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'transactions' }>
}) {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const openDetail = useUiStore((state) => state.openDetail)

  const rows = useMemo(() => {
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]))
    return artifact.ids
      .map((id) => byId.get(id))
      .filter((transaction): transaction is Transaction => transaction !== undefined)
  }, [transactions, artifact.ids])

  return (
    <Shell title={artifact.title} meta={`${rows.length} opération(s)`}>
      {rows.length === 0 ? (
        <EmptyRow>Ces opérations ne sont plus disponibles dans le coffre.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {rows.map((transaction) => (
            <li key={transaction.id}>
              <button
                type="button"
                onClick={() => openDetail({ kind: 'transaction', id: transaction.id })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {resolveDisplayName(transaction, aliases)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatDate(transaction.date)} ·{' '}
                    {categoryById(categoryIdOf(transaction, aliases)).name}
                  </p>
                </div>
                <Amount value={transaction.amount} className="text-sm" />
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Marchands                                                                  */
/* -------------------------------------------------------------------------- */

function MerchantsArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'merchants' }>
}) {
  const focusMerchant = useUiStore((state) => state.focusMerchant)

  return (
    <Shell title={artifact.title} meta={`${artifact.items.length} marchand(s)`}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucun marchand sur cette période.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {artifact.items.map((merchant) => (
            <li key={merchant.merchantKey}>
              <button
                type="button"
                onClick={() => focusMerchant(merchant.merchantKey)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{merchant.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {merchant.count} opération(s)
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatAmount(merchant.total)}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Catégories                                                                 */
/* -------------------------------------------------------------------------- */

function CategoriesArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'categories' }>
}) {
  const total = artifact.total || artifact.items.reduce((sum, item) => sum + item.total, 0)

  return (
    <Shell title={artifact.title} meta={formatAmount(total)}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucune donnée sur cette période.</EmptyRow>
      ) : (
        <div className="px-3 py-2">
          <div className="relative mx-auto h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={artifact.items}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={58}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {artifact.items.map((item) => (
                    <Cell key={item.id} fill={item.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [formatAmount(Number(value)), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] text-muted-foreground">Total</span>
              <span className="text-[13px] font-semibold tabular-nums">
                {formatCompactAmount(total)}
              </span>
            </div>
          </div>
          <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {artifact.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatPercent(item.share)}
                  <span className="ml-2 text-muted-foreground">{formatAmount(item.total)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Séries mensuelles                                                          */
/* -------------------------------------------------------------------------- */

function MonthlyArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'monthly' }>
}) {
  return (
    <Shell title={artifact.title} meta={`${artifact.points.length} mois`}>
      <div className="h-48 w-full px-1 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={artifact.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              minTickGap={8}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: number) => formatCompactAmount(value)}
            />
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
              formatter={(value, name) => [
                formatAmount(Number(value)),
                name === 'income' ? 'Entrées' : 'Dépenses',
              ]}
            />
            <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
            <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Solde                                                                      */
/* -------------------------------------------------------------------------- */

function BalanceArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'balance' }>
}) {
  return (
    <Shell title={artifact.title} meta={`${artifact.points.length} point(s)`}>
      <div className="h-44 w-full px-1 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={artifact.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chat-balance-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              minTickGap={40}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: string) => formatDate(String(value)).replace(/ \d{4}$/, '')}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: number) => formatCompactAmount(value)}
            />
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [formatAmount(Number(value)), 'Solde']}
              labelFormatter={(label) => formatDate(String(label))}
            />
            <ReferenceLine y={0} stroke="var(--color-muted-foreground)" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#chat-balance-fill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Budgets                                                                    */
/* -------------------------------------------------------------------------- */

function BudgetsArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'budgets' }>
}) {
  return (
    <Shell title={artifact.title} meta={`${artifact.items.length} budget(s)`}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucun budget configuré.</EmptyRow>
      ) : (
        <ul className="space-y-2 px-3 py-2">
          {artifact.items.map((item) => {
            const ratio = item.limit > 0 ? item.spent / item.limit : 0
            const tone =
              ratio > 1
                ? 'bg-rose-500'
                : ratio >= 0.8
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            return (
              <li key={item.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatAmount(item.spent)} / {formatAmount(item.limit)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${tone}`}
                    style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {item.category} ·{' '}
                  {ratio > 1
                    ? `dépassé de ${formatAmount(item.spent - item.limit)}`
                    : `reste ${formatAmount(item.limit - item.spent)}`}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Récurrences                                                                */
/* -------------------------------------------------------------------------- */

function RecurringArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'recurring' }>
}) {
  const openDetail = useUiStore((state) => state.openDetail)

  return (
    <Shell title={artifact.title} meta={`${artifact.items.length} série(s)`}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucune série ne correspond.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {artifact.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openDetail({ kind: 'recurring', id: item.id })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.frequency} · prochaine le {formatDate(item.nextDate)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    DECISION_CLASSES[item.decision] ?? 'bg-muted text-muted-foreground'
                  }`}
                >
                  {DECISION_LABELS[item.decision] ?? item.decision}
                </span>
                <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                  {formatAmount(item.amount)}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Couverture et affectations                                                 */
/* -------------------------------------------------------------------------- */

function CoverageArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'coverage' }>
}) {
  const openDetail = useUiStore((state) => state.openDetail)

  return (
    <Shell title={artifact.title} meta={`${artifact.items.length} crédit(s)`}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucun crédit à afficher.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {artifact.items.map((item) => (
            <li key={item.creditId}>
              <button
                type="button"
                onClick={() => openDetail({ kind: 'transaction', id: item.creditId })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatAmount(item.covered)} couverts sur {formatAmount(item.amount)} · reste{' '}
                    {formatAmount(item.remaining)}
                  </p>
                </div>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function AllocationsArtifact({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { type: 'allocations' }>
}) {
  const openDetail = useUiStore((state) => state.openDetail)

  return (
    <Shell title={artifact.title} meta={`${artifact.items.length} affectation(s)`}>
      {artifact.items.length === 0 ? (
        <EmptyRow>Aucune affectation manuelle.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {artifact.items.map((item) => (
            <li key={item.expenseId}>
              <button
                type="button"
                onClick={() => openDetail({ kind: 'transaction', id: item.expenseId })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.expenseLabel}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    couverte par {item.creditLabel} ({formatAmount(item.creditAmount)})
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatAmount(Math.abs(item.expenseAmount))}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée                                                             */
/* -------------------------------------------------------------------------- */

function ArtifactCard({ artifact }: { artifact: AssistantArtifact }) {
  switch (artifact.type) {
    case 'transactions':
      return <TransactionsArtifact artifact={artifact} />
    case 'merchants':
      return <MerchantsArtifact artifact={artifact} />
    case 'categories':
      return <CategoriesArtifact artifact={artifact} />
    case 'monthly':
      return <MonthlyArtifact artifact={artifact} />
    case 'balance':
      return <BalanceArtifact artifact={artifact} />
    case 'budgets':
      return <BudgetsArtifact artifact={artifact} />
    case 'recurring':
      return <RecurringArtifact artifact={artifact} />
    case 'coverage':
      return <CoverageArtifact artifact={artifact} />
    case 'allocations':
      return <AllocationsArtifact artifact={artifact} />
    default:
      return null
  }
}

export function AssistantArtifacts({ artifacts }: { artifacts?: AssistantArtifact[] }) {
  if (!artifacts || artifacts.length === 0) return null

  return (
    <div className="mt-2 w-full space-y-2">
      {artifacts.map((artifact, index) => (
        <ArtifactCard key={`${artifact.type}:${index}`} artifact={artifact} />
      ))}
    </div>
  )
}
