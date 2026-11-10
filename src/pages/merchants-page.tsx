import { useMemo, useState } from 'react'
import { ChevronRight, Pencil, Search, Sparkles, Store, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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
import { merchantStats, type MerchantStat } from '@/lib/analytics'
import { CATEGORIES, categoryById } from '@/lib/categories'
import { batchSuggestMerchantCategories, batchSuggestMerchantNames } from '@/lib/ai'
import { formatAmount, formatCount, formatDate, formatSignedAmount } from '@/lib/format'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'

type SortKey =
  | 'volume'
  | 'label'
  | 'category'
  | 'count'
  | 'expenses'
  | 'income'
  | 'net'
  | 'lastDate'

const PAGE_STEP = 60

export function MerchantsPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const { range, label } = usePeriod()
  const openDetail = useUiStore((state) => state.openDetail)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'volume', direction: 'desc' })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [visible, setVisible] = useState(PAGE_STEP)
  const [editing, setEditing] = useState<MerchantStat | null>(null)

  function handleSort(key: SortKey, initial: SortDirection) {
    setSort((current) => nextSort(current, key, initial))
    setVisible(PAGE_STEP)
  }

  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const batchUpdateMerchants = useVaultStore((state) => state.batchUpdateMerchants)

  const stats = useMemo(
    () => merchantStats(transactions, range, aliases),
    [transactions, range, aliases],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr-FR')
    const rows = stats.filter((stat) => {
      if (categoryFilter !== 'all' && stat.categoryId !== categoryFilter) return false
      return (
        !query ||
        stat.label.toLocaleLowerCase('fr-FR').includes(query) ||
        stat.merchantKey.toLocaleLowerCase('fr-FR').includes(query)
      )
    })

    return sortRows(rows, sort, {
      volume: (stat) => stat.volume,
      label: (stat) => stat.label,
      category: (stat) => categoryById(stat.categoryId).name,
      count: (stat) => stat.count,
      expenses: (stat) => stat.expenses,
      income: (stat) => stat.income,
      net: (stat) => stat.net,
      lastDate: (stat) => stat.lastDate,
    })
  }, [stats, search, sort, categoryFilter])

  const totalVolume = stats.reduce((total, stat) => total + stat.volume, 0)
  const uncategorized = stats.filter((stat) => stat.categoryId === 'autres')

  // Gestion du batch renommage par IA
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiApplying, setAiApplying] = useState(false)
  const [aiPreview, setAiPreview] = useState<
    { merchantKey: string; from: string; to: string }[] | null
  >(null)
  const [categoryProcessing, setCategoryProcessing] = useState(false)
  const [categoryApplying, setCategoryApplying] = useState(false)
  const [categoryPreview, setCategoryPreview] = useState<
    {
      merchantKey: string
      name: string
      fromId: string
      toId: string
      confidence: number
    }[] | null
  >(null)

  /**
   * Marchands dont le nom ou la catégorie est en cours de traitement par l'IA.
   * Les cellules concernées passent en squelette pendant l'attente, sans
   * bloquer le reste du tableau. Les cibles sont exactement celles envoyées
   * dans la requête batch.
   */
  const renameTargets = useMemo(() => {
    if (!aiProcessing) return null
    const pool = filtered.length > 0 ? filtered : stats
    return new Set(pool.map((stat) => stat.merchantKey))
  }, [aiProcessing, filtered, stats])

  const categoryTargets = useMemo(() => {
    if (!categoryProcessing) return null
    const pool = filtered.length > 0 ? filtered : stats
    return new Set(
      pool
        .filter((stat) => !aliases[stat.merchantKey]?.categoryId)
        .map((stat) => stat.merchantKey),
    )
  }, [categoryProcessing, filtered, stats, aliases])

  async function handleBatchRenameMerchants() {
    if (!aiEnabled || !aiApiKey) {
      toast.error('IA désactivée', {
        description: 'Activez-la et renseignez une clé API dans les réglages.',
      })
      return
    }

    const candidates = filtered.length > 0 ? filtered : stats
    if (candidates.length === 0) return

    setAiProcessing(true)
    try {
      const items = candidates.map((stat) => ({
        key: stat.merchantKey,
        labels: transactions
          .filter((transaction) => transaction.merchantKey === stat.merchantKey)
          .slice(-12)
          .map((transaction) => transaction.rawLabel),
        currentName: stat.label,
      }))

      // Appel groupé (15 marchands par requête, géré par la fonction).
      const result = await batchSuggestMerchantNames(items, aiApiKey)
      if (!result.ok) {
        toast.error('Suggestion impossible', { description: result.error })
        return
      }

      const byKey = new Map(candidates.map((stat) => [stat.merchantKey, stat.label]))
      const preview = result.value
        .map((entry) => ({
          merchantKey: entry.key,
          from: byKey.get(entry.key) ?? entry.key,
          to: entry.name,
        }))
        .filter((entry) => entry.to.trim() && entry.to !== entry.from)

      if (preview.length === 0) {
        toast.info('Aucun renommage pertinent détecté.')
        return
      }
      setAiPreview(preview)
    } catch (error) {
      toast.error('Erreur IA', {
        description: error instanceof Error ? error.message : 'Inconnue',
      })
    } finally {
      setAiProcessing(false)
    }
  }

  async function handleBatchCategorize() {
    if (!aiEnabled || !aiApiKey) {
      toast.error('IA désactivée', {
        description: 'Activez-la et renseignez une clé API dans les réglages.',
      })
      return
    }

    const pool = filtered.length > 0 ? filtered : stats
    const candidates = pool.filter((stat) => !aliases[stat.merchantKey]?.categoryId)
    if (candidates.length === 0) {
      toast.info('Tous les marchands affichés ont déjà une catégorie choisie.')
      return
    }

    setCategoryProcessing(true)
    try {
      const items = candidates.map((stat) => ({
        key: stat.merchantKey,
        labels: transactions
          .filter((transaction) => transaction.merchantKey === stat.merchantKey)
          .slice(-8)
          .map((transaction) => transaction.rawLabel),
        currentName: stat.label,
      }))
      const result = await batchSuggestMerchantCategories(items, aiApiKey)
      if (!result.ok) {
        toast.error('Catégorisation impossible', { description: result.error })
        return
      }

      const byKey = new Map(candidates.map((stat) => [stat.merchantKey, stat]))
      const preview = result.value
        .map((entry) => {
          const stat = byKey.get(entry.key)
          if (!stat || entry.categoryId === stat.categoryId) return null
          return {
            merchantKey: entry.key,
            name: stat.label,
            fromId: stat.categoryId,
            toId: entry.categoryId,
            confidence: entry.confidence,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

      if (preview.length === 0) {
        toast.info('Aucune catégorie différente à proposer.')
        return
      }
      setCategoryPreview(preview)
    } catch (error) {
      toast.error('Erreur IA', {
        description: error instanceof Error ? error.message : 'Inconnue',
      })
    } finally {
      setCategoryProcessing(false)
    }
  }

  async function applyCategoryPreview() {
    if (!categoryPreview || categoryPreview.length === 0) return
    setCategoryApplying(true)
    try {
      await batchUpdateMerchants(
        categoryPreview.map((entry) => ({
          merchantKey: entry.merchantKey,
          categoryId: entry.toId,
        })),
      )
      toast.success(
        `${categoryPreview.length} marchand${categoryPreview.length > 1 ? 's' : ''} catégorisé${categoryPreview.length > 1 ? 's' : ''}`,
      )
      setCategoryPreview(null)
    } catch {
      toast.error('Application impossible')
    } finally {
      setCategoryApplying(false)
    }
  }

  async function applyAiPreview() {
    if (!aiPreview) return
    setAiApplying(true)
    try {
      await batchUpdateMerchants(
        aiPreview.map((entry) => ({
          merchantKey: entry.merchantKey,
          displayName: entry.to,
        })),
      )
      toast.success(
        `${aiPreview.length} marchand${aiPreview.length > 1 ? 's' : ''} renommé${aiPreview.length > 1 ? 's' : ''}`,
      )
      setAiPreview(null)
    } catch {
      toast.error('Application impossible')
    } finally {
      setAiApplying(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marchands"
        description={`${label} · ${formatCount(stats.length)} marchands pour ${formatAmount(totalVolume)} de volume.`}
        actions={
          <Badge variant="outline" className="gap-1">
            <Store className="size-3" />
            {formatCount(stats.length)} marchands
          </Badge>
        }
      />

      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Classement des marchands</CardTitle>
            <CardDescription>
              Cliquez sur un marchand pour ouvrir le panneau de détail, ou modifiez son nom et sa
              catégorie.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setVisible(PAGE_STEP)
                }}
                placeholder="Rechercher un marchand…"
                className="pl-8"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value)}>
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
                      {category.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {uncategorized.length > 0 ? (
              <Button
                variant={categoryFilter === 'autres' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter(categoryFilter === 'autres' ? 'all' : 'autres')}
              >
                <Tag className="size-3.5" />
                {formatCount(uncategorized.length)} à classer
              </Button>
            ) : null}
            {aiEnabled && aiApiKey ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBatchCategorize()}
                  disabled={categoryProcessing || aiProcessing}
                  title="Catégoriser les marchands sans catégorie manuelle"
                >
                  <Tag className="size-3.5" />
                  {categoryProcessing ? 'Classement…' : 'Catégoriser'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchRenameMerchants}
                  disabled={aiProcessing || categoryProcessing}
                  title="Renommer les marchands affichés"
                >
                  <Sparkles className="size-3.5" />
                  {aiProcessing ? 'Traitement…' : 'Tout renommer'}
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    label="Marchand"
                    sortKey="label"
                    sort={sort}
                    onSort={handleSort}
                    className="pl-4"
                  />
                  <SortableHeader
                    label="Catégorie"
                    sortKey="category"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Opérations"
                    sortKey="count"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Dépenses"
                    sortKey="expenses"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                  />
                  <SortableHeader
                    label="Entrées"
                    sortKey="income"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                    className="hidden md:table-cell"
                  />
                  <SortableHeader
                    label="Net"
                    sortKey="net"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                    className="hidden lg:table-cell"
                  />
                  <SortableHeader
                    label="Dernière"
                    sortKey="lastDate"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    initialDirection="desc"
                    className="hidden sm:table-cell"
                  />
                  <TableHead className="w-20 pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Aucun marchand ne correspond à cette recherche.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, visible).map((stat) => {
                    const renaming = renameTargets?.has(stat.merchantKey) ?? false
                    const recategorizing = categoryTargets?.has(stat.merchantKey) ?? false
                    return (
                      <TableRow
                        key={stat.merchantKey}
                        onClick={() =>
                          openDetail({ kind: 'merchant', merchantKey: stat.merchantKey })
                        }
                        className="cursor-pointer"
                        aria-busy={renaming || recategorizing}
                      >
                        <TableCell className="max-w-[280px] pl-4">
                          {renaming ? (
                            <Skeleton className="h-4 w-32" aria-hidden />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className="block max-w-full truncate text-left font-medium hover:underline"
                            >
                              {stat.label}
                            </button>
                          )}
                          <p className="truncate text-xs text-muted-foreground">{stat.merchantKey}</p>
                        </TableCell>
                        <TableCell>
                          {recategorizing ? (
                            <Skeleton className="h-5 w-20 rounded-full" aria-hidden />
                          ) : (
                            <CategoryBadge categoryId={stat.categoryId} />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCount(stat.count)}</TableCell>
                        <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                          {formatAmount(stat.expenses)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums text-emerald-600 md:table-cell dark:text-emerald-400">
                          {formatAmount(stat.income)}
                        </TableCell>
                        <TableCell className="hidden text-right font-medium tabular-nums lg:table-cell">
                          {formatSignedAmount(stat.net)}
                        </TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                          {formatDate(stat.lastDate)}
                        </TableCell>
                        <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Voir les transactions"
                              onClick={() =>
                                openDetail({ kind: 'merchant', merchantKey: stat.merchantKey })
                              }
                            >
                              <ChevronRight className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Modifier le marchand"
                              onClick={() => setEditing(stat)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {visible < filtered.length ? (
            <div className="flex items-center justify-center border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setVisible((value) => value + PAGE_STEP)}>
                Afficher {Math.min(PAGE_STEP, filtered.length - visible)} marchands de plus
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <MerchantDialog
        key={editing?.merchantKey ?? 'closed'}
        merchantKey={editing?.merchantKey ?? null}
        initialLabel={editing?.label ?? ''}
        initialCategoryId={editing?.categoryId ?? 'autres'}
        onClose={() => setEditing(null)}
      />

      <Dialog open={aiPreview !== null} onOpenChange={(open) => !open && setAiPreview(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Prévisualiser les renommages
            </DialogTitle>
            <DialogDescription>
              Vérifiez les noms proposés : rien n’est appliqué avant votre validation.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom actuel</TableHead>
                  <TableHead>Proposition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiPreview?.map((entry) => (
                  <TableRow key={entry.merchantKey} className="text-xs">
                    <TableCell className="max-w-[190px] truncate text-muted-foreground">
                      {entry.from}
                    </TableCell>
                    <TableCell className="max-w-[190px] truncate font-medium">
                      {entry.to}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAiPreview(null)}
              disabled={aiApplying}
            >
              Annuler
            </Button>
            <Button onClick={() => void applyAiPreview()} disabled={aiApplying}>
              {aiApplying
                ? 'Application…'
                : `Appliquer ${aiPreview?.length ?? 0} renommage${(aiPreview?.length ?? 0) > 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={categoryPreview !== null}
        onOpenChange={(open) => !open && setCategoryPreview(null)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="size-4" />
              Prévisualiser les catégories
            </DialogTitle>
            <DialogDescription>
              Seuls les marchands sans catégorie manuelle sont proposés. Rien n’est appliqué avant
              validation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {categoryPreview?.map((entry) => (
              <div
                key={entry.merchantKey}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {categoryById(entry.fromId).name} → {categoryById(entry.toId).name}
                    {' · '}
                    {Math.round(entry.confidence * 100)} %
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() =>
                    setCategoryPreview((current) =>
                      current ? current.filter((item) => item.merchantKey !== entry.merchantKey) : current,
                    )
                  }
                >
                  Retirer
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCategoryPreview(null)}
              disabled={categoryApplying}
            >
              Annuler
            </Button>
            <Button
              onClick={() => void applyCategoryPreview()}
              disabled={categoryApplying || (categoryPreview?.length ?? 0) === 0}
            >
              {categoryApplying
                ? 'Application…'
                : `Appliquer ${categoryPreview?.length ?? 0} catégorie${(categoryPreview?.length ?? 0) > 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}