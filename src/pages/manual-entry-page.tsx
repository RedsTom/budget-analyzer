import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Plus, Receipt, Wallet } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CategoryBadge } from '@/components/category-badge'
import { DataList, DataListRow } from '@/components/data-list'
import { PageHeader } from '@/components/page-header'
import { SortableHeader } from '@/components/sortable-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import { categoryById } from '@/lib/categories'
import { formatAmount, formatCount, formatDate } from '@/lib/format'
import { inRange } from '@/lib/period'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'

type HistorySortKey = 'date' | 'label' | 'category' | 'amount'

export function ManualEntryPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const openQuickEntry = useUiStore((state) => state.openQuickEntry)
  const { range } = usePeriod()

  const manualTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          (transaction.isManual || transaction.sourceFile === 'manual') &&
          inRange(transaction, range),
      ),
    [transactions, range],
  )

  const [historySort, setHistorySort] = useState<SortState<HistorySortKey>>({
    key: 'date',
    direction: 'desc',
  })

  function handleHistorySort(key: HistorySortKey, initial: SortDirection) {
    setHistorySort((current) => nextSort(current, key, initial))
  }

  const sortedManual = useMemo(
    () =>
      sortRows(manualTransactions, historySort, {
        date: (transaction) =>
          `${transaction.date}#${String(transaction.order).padStart(6, '0')}`,
        label: (transaction) => transaction.displayName || transaction.rawLabel,
        category: (transaction) => categoryById(transaction.categoryId ?? 'autres').name,
        amount: (transaction) => transaction.amount,
      }),
    [manualTransactions, historySort],
  )

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const transaction of manualTransactions) {
      if (transaction.amount > 0) income += transaction.amount
      else expense += -transaction.amount
    }
    return { income, expense, count: manualTransactions.length }
  }, [manualTransactions])

  const openNew = () => openQuickEntry({ type: 'expense' })
  const openEdit = (id: string) => openQuickEntry({ id })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saisie manuelle"
        description="Opérations ajoutées hors relevé bancaire, limitées à la période sélectionnée. Cliquez sur une ligne pour la modifier."
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" />
            Nouvelle opération
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Dépenses manuelles"
          value={formatAmount(totals.expense)}
          hint="Total des sorties manuelles"
          icon={<ArrowDownRight className="size-3.5" />}
          accent="expense"
        />
        <StatCard
          label="Recettes manuelles"
          value={formatAmount(totals.income)}
          hint="Total des entrées manuelles"
          icon={<ArrowUpRight className="size-3.5" />}
          accent="income"
        />
        <StatCard
          label="Impact net sur le solde"
          value={formatAmount(totals.income - totals.expense)}
          hint="Intégré au grand livre"
          icon={<Wallet className="size-3.5" />}
          accent={totals.income >= totals.expense ? 'income' : 'expense'}
        />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Historique des saisies</CardTitle>
              <CardDescription>
                {formatCount(totals.count)} opération
                {totals.count > 1 ? 's' : ''} manuelle
                {totals.count > 1 ? 's' : ''}.
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1">
              <Receipt className="size-3" />
              Hors relevé
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {sortedManual.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <Receipt className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Aucune opération manuelle sur cette période.
              </p>
              <Button size="sm" onClick={openNew}>
                <Plus className="size-4" />
                Ajouter une première opération
              </Button>
            </div>
          ) : (
            <>
              <DataList className="md:hidden">
                {sortedManual.map((transaction) => (
                  <DataListRow
                    key={transaction.id}
                    primary={transaction.displayName || transaction.rawLabel}
                    secondary={`${formatDate(transaction.date)} · ${
                      categoryById(transaction.categoryId ?? 'autres').name
                    }${transaction.note ? ` · ${transaction.note}` : ''}`}
                    amount={formatAmount(transaction.amount)}
                    amountClassName={
                      transaction.amount > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : undefined
                    }
                    onClick={() => openEdit(transaction.id)}
                    ariaLabel={`Modifier ${transaction.displayName || transaction.rawLabel}`}
                  />
                ))}
              </DataList>

              <div className="hidden overflow-x-auto border-t md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader
                        label="Date"
                        sortKey="date"
                        sort={historySort}
                        onSort={handleHistorySort}
                        initialDirection="desc"
                        className="w-28 pl-4"
                      />
                      <SortableHeader
                        label="Libellé"
                        sortKey="label"
                        sort={historySort}
                        onSort={handleHistorySort}
                      />
                      <SortableHeader
                        label="Catégorie"
                        sortKey="category"
                        sort={historySort}
                        onSort={handleHistorySort}
                      />
                      <SortableHeader
                        label="Montant"
                        sortKey="amount"
                        sort={historySort}
                        onSort={handleHistorySort}
                        align="right"
                        initialDirection="desc"
                        className="pr-4"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedManual.map((transaction) => (
                      <TableRow
                        key={transaction.id}
                        onClick={() => openEdit(transaction.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="pl-4 whitespace-nowrap text-muted-foreground">
                          {formatDate(transaction.date)}
                        </TableCell>
                        <TableCell className="max-w-[28rem]">
                          <p className="truncate font-medium">
                            {transaction.displayName || transaction.rawLabel}
                          </p>
                          {transaction.note ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {transaction.note}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <CategoryBadge categoryId={transaction.categoryId ?? 'autres'} />
                        </TableCell>
                        <TableCell className="pr-4 text-right font-medium tabular-nums">
                          <span
                            className={
                              transaction.amount > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : undefined
                            }
                          >
                            {formatAmount(transaction.amount)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
