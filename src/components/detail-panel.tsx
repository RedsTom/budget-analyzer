import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { CategoryBadge } from '@/components/category-badge'
import { categoryIdOf } from '@/lib/categories'
import { formatAmount, formatDate, formatSignedAmount } from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import type { AliasEntry, Transaction } from '@/lib/types'

export interface DetailStat {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'expense' | 'income'
}

interface DetailPanelProps {
  title: ReactNode
  description?: ReactNode
  badges?: ReactNode
  stats?: DetailStat[]
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}

/**
 * Contenu du panneau de détail. Le panneau est une colonne de la page
 * (voir `DetailHost`), pas une surcouche : la page se rétrécit à sa gauche.
 */
export function DetailPanel({
  title,
  description,
  badges,
  stats,
  children,
  footer,
  onClose,
}: DetailPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative flex shrink-0 flex-col gap-1.5 border-b p-4 pr-12">
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="break-words text-sm text-muted-foreground">{description}</p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          aria-label="Fermer le panneau"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="min-w-0 space-y-5 p-4">
          {stats && stats.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                  <p
                    className={cn(
                      'truncate text-sm font-semibold tabular-nums',
                      stat.tone === 'expense' && 'text-rose-600 dark:text-rose-400',
                      stat.tone === 'income' && 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {stat.value}
                  </p>
                  {stat.hint ? (
                    <p className="truncate text-[11px] text-muted-foreground">{stat.hint}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {children}
        </div>
      </div>

      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-4">{footer}</div>
      ) : null}
    </div>
  )
}

export function TransactionList({
  transactions,
  aliases,
  highlightId,
  emptyLabel = 'Aucune opération.',
}: {
  transactions: Transaction[]
  aliases: Record<string, AliasEntry>
  highlightId?: string
  emptyLabel?: string
}) {
  if (transactions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      {transactions.map((transaction) => (
        <div
          key={transaction.id}
          className={cn(
            'flex items-start justify-between gap-3 border-b px-3 py-2.5 last:border-b-0',
            transaction.id === highlightId && 'bg-primary/5',
          )}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-medium">
                {resolveDisplayName(transaction, aliases)}
              </p>
              <CategoryBadge
                categoryId={categoryIdOf(transaction, aliases)}
                className="px-1.5 py-0 text-[10px]"
              />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {formatDate(transaction.date)} · {transaction.rawLabel}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                'text-sm font-medium whitespace-nowrap tabular-nums',
                transaction.amount < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {formatSignedAmount(transaction.amount)}
            </p>
            <p className="text-[11px] whitespace-nowrap text-muted-foreground">
              solde {formatAmount(transaction.solde)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
