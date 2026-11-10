import { useMemo, useState } from 'react'
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { ArrowDownRight, ArrowUpRight, CalendarClock, ChevronRight, Percent, Wallet } from 'lucide-react'
import {
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { PageHeader } from '@/components/page-header'
import { SortableHeader } from '@/components/sortable-header'
import { StatCard } from '@/components/stat-card'
import { usePeriod } from '@/hooks/use-period'
import { askAssistant } from '@/lib/ai'
import {
  categoryBreakdown,
  highlights,
  monthlySeries,
  percentChange,
  totalsForRange,
  weekdayBreakdown,
} from '@/lib/analytics'
import { buildAssistantContext } from '@/lib/assistant-context'
import {
  formatAmount,
  formatCompactAmount,
  formatCount,
  formatDate,
  formatMonth,
  formatPercent,
  formatSignedAmount,
} from '@/lib/format'
import type { DateRange } from '@/lib/period'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import { useVaultStore } from '@/store/vault-store'
import { useUiStore } from '@/store/ui-store'

const CHART_TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
}

type MonthSortKey = 'month' | 'income' | 'expenses' | 'net' | 'count'

export function AnalysisPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const budgets = useVaultStore((state) => state.budgets)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const { range, previous, label } = usePeriod()
  const drillIntoRange = useUiStore((state) => state.drillIntoRange)

  const [direction, setDirection] = useState<'expense' | 'income'>('expense')
  const [monthSort, setMonthSort] = useState<SortState<MonthSortKey>>({
    key: 'month',
    direction: 'asc',
  })

  function handleMonthSort(key: MonthSortKey, initial: SortDirection) {
    setMonthSort((current) => nextSort(current, key, initial))
  }

  const totals = useMemo(() => totalsForRange(transactions, range), [transactions, range])
  const previousTotals = useMemo(
    () => totalsForRange(transactions, previous),
    [transactions, previous],
  )
  const months = useMemo(() => monthlySeries(transactions, range), [transactions, range])
  const sortedMonths = useMemo(
    () =>
      sortRows(months, monthSort, {
        month: (point) => point.month,
        income: (point) => point.income,
        expenses: (point) => point.expenses,
        net: (point) => point.net,
        count: (point) => point.count,
      }),
    [months, monthSort],
  )
  const slices = useMemo(
    () => categoryBreakdown(transactions, range, aliases, direction),
    [transactions, range, aliases, direction],
  )
  const weekdays = useMemo(() => weekdayBreakdown(transactions, range), [transactions, range])
  const facts = useMemo(() => highlights(transactions, range, aliases), [transactions, range, aliases])

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

  const slicesTotal = slices.reduce((total, slice) => total + slice.total, 0)
  const topSlices = slices.slice(0, 6)
  const otherSlices = slices.slice(6)
  const othersTotal = otherSlices.reduce((total, slice) => total + slice.total, 0)

  function drillMonth(month: string) {
    const start = startOfMonth(parseISO(`${month}-01`))
    const end = endOfMonth(start)
    const next: DateRange = {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
    }
    drillIntoRange(next)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analyses"
        description={`${label} · comparaison avec la période précédente (${formatDate(
          previous.start,
        )} → ${formatDate(previous.end)})`}
        actions={
          <Badge variant="outline" className="gap-1">
            <CalendarClock className="size-3" />
            {label}
          </Badge>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          label="Net"
          value={formatSignedAmount(totals.net)}
          deltaAmount={totals.net - previousTotals.net}
          hint={`avant : ${formatSignedAmount(previousTotals.net)}`}
          icon={<Wallet className="size-3.5" />}
        />
        <StatCard
          label="Taux d’épargne"
          value={totals.savingsRate === null ? '—' : formatPercent(totals.savingsRate)}
          hint={
            previousTotals.savingsRate === null
              ? 'aucune entrée avant'
              : `avant : ${formatPercent(previousTotals.savingsRate)}`
          }
          icon={<Percent className="size-3.5" />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Entrées et sorties par mois</CardTitle>
            <CardDescription>
              Cliquez sur une barre ou une ligne pour ouvrir les mouvements du mois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--color-border)"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    minTickGap={12}
                  />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value: number) => formatCompactAmount(value)}
                  />
                  <RechartsTooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                    formatter={(value, name) => [
                      formatAmount(Number(value)),
                      name === 'income' ? 'Entrées' : 'Dépenses',
                    ]}
                  />
                  <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                  <Bar
                    dataKey="income"
                    name="income"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    className="cursor-pointer"
                    onClick={(_data, index) => drillMonth(months[index].month)}
                  />
                  <Bar
                    dataKey="expenses"
                    name="expenses"
                    fill="#f43f5e"
                    radius={[4, 4, 0, 0]}
                    className="cursor-pointer"
                    onClick={(_data, index) => drillMonth(months[index].month)}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-emerald-500" />
                Entrées
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500" />
                Dépenses
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition par catégorie</CardTitle>
            <CardDescription>
              {direction === 'expense' ? 'Dépenses' : 'Entrées'} de la période
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={direction}
              onValueChange={(value) => setDirection(value as 'expense' | 'income')}
            >
              <TabsList className="w-full">
                <TabsTrigger value="expense">Dépenses</TabsTrigger>
                <TabsTrigger value="income">Entrées</TabsTrigger>
              </TabsList>
              <TabsContent value={direction} className="mt-3 space-y-3">
                {slices.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucune donnée sur cette période.
                  </p>
                ) : (
                  <>
                    <div className="relative mx-auto h-36 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={slices}
                            dataKey="total"
                            nameKey="name"
                            innerRadius={40}
                            outerRadius={58}
                            paddingAngle={2}
                            strokeWidth={0}
                          >
                            {slices.map((slice) => (
                              <Cell key={slice.id} fill={slice.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            contentStyle={CHART_TOOLTIP_STYLE}
                            formatter={(value, name) => [
                              formatAmount(Number(value)),
                              String(name),
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-muted-foreground">Total</span>
                        <span className="text-[13px] font-semibold tabular-nums">
                          {formatAmount(slicesTotal)}
                        </span>
                      </div>
                    </div>
                    <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                      {topSlices.map((slice) => (
                        <div key={slice.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: slice.color }}
                            />
                            <span className="truncate">{slice.name}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {formatPercent(slice.share)}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {formatAmount(slice.total)}
                            </span>
                          </span>
                        </div>
                      ))}
                      {otherSlices.length > 0 ? (
                        <p className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                          <span>{formatCount(otherSlices.length)} autres catégories</span>
                          <span className="shrink-0 tabular-nums">{formatAmount(othersTotal)}</span>
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dépenses par jour de la semaine</CardTitle>
            <CardDescription>Où partent vos dépenses dans la semaine</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--color-border)"
                  />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value: number) => formatCompactAmount(value)}
                  />
                  <RechartsTooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                    formatter={(value) => [formatAmount(Number(value)), 'Dépenses']}
                  />
                  <Bar dataKey="total" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Faits saillants</CardTitle>
            <CardDescription>Les chiffres marquants de la période</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.id} className="rounded-lg border bg-muted/30 p-2.5">
                <p className="text-xs text-muted-foreground">{fact.title}</p>
                <p className="mt-0.5 truncate font-heading text-base font-semibold">{fact.value}</p>
                <p className="truncate text-xs text-muted-foreground">{fact.hint}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <AiInsightCard
        key={`${range.start}:${range.end}`}
        title="Synthèse IA de la période"
        hint="Demandez une lecture des chiffres de la période : évolution, poste à surveiller et piste concrète."
        cta="Analyser"
        allowPrompt
        placeholder="Ex : pourquoi mes dépenses augmentent-elles ?"
        suggestions={[
          'Quel poste dérive le plus ?',
          'Où puis-je économiser sans effort ?',
          'Comparer avec la période précédente',
        ]}
        onRun={(question) =>
          askAssistant(
            aiContext,
            question ??
              'Fais une synthèse de la période : évolution, poste à surveiller et piste concrète.',
            aiApiKey,
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Détail mensuel</CardTitle>
          <CardDescription>
            Cliquez sur un mois pour filtrer les transactions correspondantes.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    label="Mois"
                    sortKey="month"
                    sort={monthSort}
                    onSort={handleMonthSort}
                    className="pl-4"
                  />
                  <SortableHeader
                    label="Entrées"
                    sortKey="income"
                    sort={monthSort}
                    onSort={handleMonthSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Dépenses"
                    sortKey="expenses"
                    sort={monthSort}
                    onSort={handleMonthSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Net"
                    sortKey="net"
                    sort={monthSort}
                    onSort={handleMonthSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Mouvements"
                    sortKey="count"
                    sort={monthSort}
                    onSort={handleMonthSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMonths.map((month) => (
                  <TableRow
                    key={month.month}
                    className="cursor-pointer"
                    onClick={() => drillMonth(month.month)}
                  >
                    <TableCell className="pl-4 font-medium capitalize">
                      {formatMonth(month.month)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatAmount(month.income)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                      {formatAmount(month.expenses)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatSignedAmount(month.net)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCount(month.count)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button variant="ghost" size="icon-sm" aria-label="Voir les mouvements">
                        <ChevronRight className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
