import { useMemo, useState } from 'react'
import { ChevronRight, Download, Pencil, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { CategoryBadge } from '@/components/category-badge'
import { MerchantDialog } from '@/components/merchant-dialog'
import { PageHeader } from '@/components/page-header'
import { SortableHeader } from '@/components/sortable-header'
import { usePeriod } from '@/hooks/use-period'
import { summarize, transactionsInRange } from '@/lib/analytics'
import { CATEGORIES, categoryById, categoryIdOf } from '@/lib/categories'
import {
  formatAmount,
  formatCount,
  formatDate,
  formatSignedAmount,
} from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import type { Transaction } from '@/lib/types'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'

type SortKey = 'date' | 'merchant' | 'category' | 'amount' | 'solde'

const PAGE_SIZE = 80

export function TransactionsPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const { range, label } = usePeriod()

  const search = useUiStore((state) => state.search)
  const setSearch = useUiStore((state) => state.setSearch)
  const merchantFilter = useUiStore((state) => state.merchantFilter)
  const setMerchantFilter = useUiStore((state) => state.setMerchantFilter)
  const categoryFilter = useUiStore((state) => state.categoryFilter)
  const setCategoryFilter = useUiStore((state) => state.setCategoryFilter)
  const typeFilter = useUiStore((state) => state.typeFilter)
  const setTypeFilter = useUiStore((state) => state.setTypeFilter)
  const resetFilters = useUiStore((state) => state.resetFilters)
  const openDetail = useUiStore((state) => state.openDetail)

  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'date', direction: 'desc' })
  const [pagination, setPagination] = useState({ key: '', visible: PAGE_SIZE })
  const [editing, setEditing] = useState<Transaction | null>(null)

  function handleSort(key: SortKey, initial: SortDirection) {
    setSort((current) => nextSort(current, key, initial))
  }

  const scoped = useMemo(
    () => transactionsInRange(transactions, range),
    [transactions, range],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr-FR')

    const rows = scoped.filter((transaction) => {
      if (typeFilter === 'expense' && transaction.amount >= 0) return false
      if (typeFilter === 'income' && transaction.amount <= 0) return false
      if (merchantFilter && transaction.merchantKey !== merchantFilter) return false
      if (categoryFilter && categoryIdOf(transaction, aliases) !== categoryFilter) {
        return false
      }
      if (!query) return true

      const name = resolveDisplayName(transaction, aliases)
      return (
        name.toLocaleLowerCase('fr-FR').includes(query) ||
        transaction.rawLabel.toLocaleLowerCase('fr-FR').includes(query) ||
        transaction.merchantKey.toLocaleLowerCase('fr-FR').includes(query) ||
        transaction.date.includes(query) ||
        transaction.amount.toFixed(2).includes(query)
      )
    })

    return sortRows(rows, sort, {
      // L'ordre du grand livre départage les opérations d'une même date.
      date: (transaction) => `${transaction.date}#${String(transaction.order).padStart(6, '0')}`,
      merchant: (transaction) => resolveDisplayName(transaction, aliases),
      category: (transaction) => categoryById(categoryIdOf(transaction, aliases)).name,
      amount: (transaction) => transaction.amount,
      solde: (transaction) => transaction.solde,
    })
  }, [scoped, search, aliases, typeFilter, merchantFilter, categoryFilter, sort])

  const totals = useMemo(() => summarize(filtered), [filtered])

  // La pagination est indexée sur les filtres : changer un filtre repart de la
  // première page sans passer par un effet de synchronisation.
  const filterKey = [
    search,
    typeFilter,
    merchantFilter ?? '',
    categoryFilter ?? '',
    range.start,
    range.end,
    `${sort.key}:${sort.direction}`,
  ].join('|')
  const visible = pagination.key === filterKey ? pagination.visible : PAGE_SIZE

  const merchantLabel = merchantFilter
    ? resolveDisplayName(
        {
          rawLabel: merchantFilter,
          merchantKey: merchantFilter,
        },
        aliases,
      )
    : null

  const hasFilters =
    Boolean(search) || Boolean(merchantFilter) || Boolean(categoryFilter) || typeFilter !== 'all'

  function exportCsv() {
    const header = [
      'Date',
      'Date de valeur',
      'Débit',
      'Crédit',
      'Libellé',
      'Solde',
      'Marchand',
      'Catégorie',
    ]
    const number = (value: number | null) =>
      value === null ? '' : value.toFixed(2).replace('.', ',')
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const lines = filtered.map((transaction) =>
      [
        transaction.date,
        transaction.valueDate,
        number(transaction.debit),
        number(transaction.credit),
        escape(transaction.rawLabel),
        number(transaction.solde),
        escape(resolveDisplayName(transaction, aliases)),
        escape(CATEGORIES.find((item) => item.id === categoryIdOf(transaction, aliases))?.name ?? ''),
      ].join(';'),
    )

    const csv = `\uFEFF${[header.join(';'), ...lines].join('\r\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `transactions-${range.start}-${range.end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description={`${label} · ${formatCount(scoped.length)} mouvements`}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-3.5" />
            Exporter en CSV
          </Button>
        }
      />

      <Card size="sm">
        <CardContent className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Mouvements</p>
            <p className="text-lg font-semibold tabular-nums">{formatCount(filtered.length)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Entrées</p>
            <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatAmount(totals.income)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dépenses</p>
            <p className="text-lg font-semibold tabular-nums text-rose-600 dark:text-rose-400">
              {formatAmount(totals.expenses)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net</p>
            <p className="text-lg font-semibold tabular-nums">{formatSignedAmount(totals.net)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Mouvements</CardTitle>
                <CardDescription>
                  Filtrez, recherchez et classez les opérations de la période.
                </CardDescription>
              </div>
              {hasFilters ? (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <X className="size-3.5" />
                  Réinitialiser
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher un libellé, un montant, une date…"
                  className="pl-8"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={typeFilter}
                  onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}
                >
                  <SelectTrigger size="sm" className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous types</SelectItem>
                    <SelectItem value="expense">Dépenses</SelectItem>
                    <SelectItem value="income">Entrées</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={categoryFilter ?? 'all'}
                  onValueChange={(value) =>
                    setCategoryFilter(value === 'all' ? null : (value as typeof categoryFilter))
                  }
                >
                  <SelectTrigger size="sm" className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes catégories</SelectItem>
                    {CATEGORIES.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          {category.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {merchantLabel ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  Marchand : {merchantLabel}
                  <button
                    type="button"
                    onClick={() => setMerchantFilter(null)}
                    aria-label="Retirer le filtre marchand"
                    className="rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    label="Date"
                    sortKey="date"
                    sort={sort}
                    onSort={handleSort}
                    initialDirection="desc"
                    className="pl-4 whitespace-nowrap"
                  />
                  <SortableHeader
                    label="Marchand"
                    sortKey="merchant"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Catégorie"
                    sortKey="category"
                    sort={sort}
                    onSort={handleSort}
                    className="hidden md:table-cell"
                  />
                  <SortableHeader
                    label="Montant"
                    sortKey="amount"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Solde"
                    sortKey="solde"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                    className="hidden sm:table-cell"
                  />
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Aucun mouvement ne correspond à ces filtres.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, visible).map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      onClick={() => openDetail({ kind: 'transaction', id: transaction.id })}
                      className="cursor-pointer"
                    >
                      <TableCell className="pl-4 whitespace-nowrap text-muted-foreground">
                        {formatDate(transaction.date)}
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <button
                          type="button"
                          onClick={() =>
                            openDetail({ kind: 'transaction', id: transaction.id })
                          }
                          className="block max-w-full truncate text-left font-medium hover:underline"
                        >
                          {resolveDisplayName(transaction, aliases)}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">
                          {transaction.rawLabel}
                        </p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <CategoryBadge categoryId={categoryIdOf(transaction, aliases)} />
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium whitespace-nowrap tabular-nums ${
                          transaction.amount < 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatSignedAmount(transaction.amount)}
                      </TableCell>
                      <TableCell className="hidden text-right whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell">
                        {formatAmount(transaction.solde)}
                      </TableCell>
                      <TableCell className="pr-4" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Voir les transactions similaires"
                            onClick={() =>
                              openDetail({ kind: 'transaction', id: transaction.id })
                            }
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Modifier le marchand"
                            onClick={() => setEditing(transaction)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {visible < filtered.length ? (
            <div className="flex items-center justify-center border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setPagination({ key: filterKey, visible: visible + PAGE_SIZE })}>
                Afficher {Math.min(PAGE_SIZE, filtered.length - visible)} mouvements de plus
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <MerchantDialog
        key={editing?.merchantKey ?? 'closed'}
        merchantKey={editing?.merchantKey ?? null}
        initialLabel={editing ? resolveDisplayName(editing, aliases) : ''}
        initialCategoryId={editing ? categoryIdOf(editing, aliases) : 'autres'}
        rawLabel={editing?.rawLabel}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
