import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Pencil,
  Plus,
  Receipt,
  SquarePen,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { PageHeader } from '@/components/page-header'
import { SortableHeader } from '@/components/sortable-header'
import { StatCard } from '@/components/stat-card'
import { CATEGORIES, categoryById } from '@/lib/categories'
import { formatAmount, formatCount, formatDate } from '@/lib/format'
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortState,
} from '@/lib/table-sort'
import type { Transaction } from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'

type HistorySortKey = 'date' | 'label' | 'category' | 'amount'

export function ManualEntryPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const addManualTransaction = useVaultStore((state) => state.addManualTransaction)
  const updateManualTransaction = useVaultStore((state) => state.updateManualTransaction)
  const deleteManualTransaction = useVaultStore((state) => state.deleteManualTransaction)

  // Formulaire d'ajout / édition
  const [editingId, setEditingId] = useState<string | null>(null)
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amountStr, setAmountStr] = useState('')
  const [label, setLabel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('autres')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Liste des opérations manuelles existantes
  const manualTransactions = useMemo(() => {
    return transactions.filter((t) => t.isManual || t.sourceFile === 'manual').reverse()
  }, [transactions])

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
        date: (transaction) => transaction.date,
        label: (transaction) => transaction.displayName || transaction.rawLabel,
        category: (transaction) => categoryById(transaction.categoryId ?? 'autres').name,
        amount: (transaction) => transaction.amount,
      }),
    [manualTransactions, historySort],
  )

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const t of manualTransactions) {
      if (t.amount > 0) income += t.amount
      else expense += -t.amount
    }
    return { income, expense, count: manualTransactions.length }
  }, [manualTransactions])

  function resetForm() {
    setEditingId(null)
    setType('expense')
    setDate(new Date().toISOString().slice(0, 10))
    setAmountStr('')
    setLabel('')
    setDisplayName('')
    setCategoryId('autres')
    setNote('')
  }

  function startEdit(tx: Transaction) {
    setEditingId(tx.id)
    setType(tx.amount < 0 ? 'expense' : 'income')
    setDate(tx.date)
    setAmountStr(String(Math.abs(tx.amount)))
    setLabel(tx.rawLabel)
    setDisplayName(tx.displayName ?? '')
    setCategoryId(tx.categoryId ?? 'autres')
    setNote(tx.note ?? '')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const parsedAmount = parseFloat(amountStr.replace(',', '.'))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Veuillez saisir un montant valide supérieur à 0.')
      return
    }
    if (!label.trim()) {
      toast.error('Veuillez renseigner un libellé.')
      return
    }

    const finalAmount = type === 'expense' ? -parsedAmount : parsedAmount
    const payload = {
      date,
      amount: finalAmount,
      rawLabel: label.trim(),
      displayName: displayName.trim() || undefined,
      categoryId: categoryId === 'autres' ? undefined : categoryId,
      note: note.trim() || undefined,
    }

    setSubmitting(true)
    try {
      if (editingId) {
        await updateManualTransaction(editingId, payload)
        toast.success('Opération manuelle mise à jour')
      } else {
        await addManualTransaction(payload)
        toast.success(
          type === 'expense'
            ? 'Dépense manuelle enregistrée'
            : 'Recette manuelle enregistrée',
        )
      }
      resetForm()
    } catch {
      toast.error('Erreur lors de l’enregistrement')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteManualTransaction(id)
      if (editingId === id) resetForm()
      toast.success('Opération manuelle supprimée')
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saisie manuelle"
        description="Ajoutez des dépenses ou recettes hors relevés bancaires (espèces, chèques, opérations non synchronisées) tout en maintenant la continuité de vos soldes."
        actions={
          <Badge variant="outline" className="gap-1">
            <Receipt className="size-3" />
            {formatCount(totals.count)} opération{totals.count > 1 ? 's' : ''} manuelle{totals.count > 1 ? 's' : ''}
          </Badge>
        }
      />

      {/* KPI des opérations manuelles */}
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Formulaire de saisie */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SquarePen className="size-5" />
            </div>
            <CardTitle>{editingId ? 'Modifier l’opération' : 'Ajouter une opération'}</CardTitle>
            <CardDescription>
              Le solde et la couverture seront automatiquement mis à jour.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              {/* Type : Dépense ou Recette */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1">
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    type === 'expense'
                      ? 'bg-destructive/10 text-destructive font-semibold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowDownRight className="size-3.5" />
                  Dépense
                </button>
                <button
                  type="button"
                  onClick={() => setType('income')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    type === 'income'
                      ? 'bg-emerald-500/10 text-emerald-600 font-semibold shadow-xs dark:text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowUpRight className="size-3.5" />
                  Recette
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-date">Date</Label>
                <Input
                  id="tx-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-amount">Montant (€)</Label>
                <Input
                  id="tx-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0,00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-label">Libellé bancaire / brut</Label>
                <Input
                  id="tx-label"
                  placeholder="Ex: RETRAIT DISTRIBUTEUR, CHÈQUE..."
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-display">Nom lisible (optionnel)</Label>
                <Input
                  id="tx-display"
                  placeholder="Ex: Boulangerie, Cadeau anniversaire..."
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-category">Catégorie</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="tx-category">
                    <SelectValue placeholder="Catégorie" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-note">Note (optionnel)</Label>
                <Input
                  id="tx-note"
                  placeholder="Ex : achat en espèces, remboursement…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1 gap-1.5" disabled={submitting}>
                  {editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                  {editingId
                    ? 'Mettre à jour'
                    : type === 'expense'
                      ? 'Enregistrer la dépense'
                      : 'Enregistrer la recette'}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Annuler la modification"
                    onClick={resetForm}
                    disabled={submitting}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Historique des opérations manuelles */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Historique des saisies manuelles</CardTitle>
            <CardDescription>
              Toutes les opérations créées sans fichier CSV.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {manualTransactions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Receipt className="mx-auto mb-2 size-8 opacity-40" />
                Aucune opération manuelle pour l’instant.
              </div>
            ) : (
              <div className="rounded-lg border bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader
                        label="Date"
                        sortKey="date"
                        sort={historySort}
                        onSort={handleHistorySort}
                        initialDirection="desc"
                        className="w-24"
                      />
                      <SortableHeader
                        label="Libellé / Marchand"
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
                      />
                      <TableHead className="w-12 text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedManual.map((tx) => (
                      <TableRow key={tx.id} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground">
                          {formatDate(tx.date)}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {tx.displayName || tx.rawLabel}
                          {tx.note ? (
                            <p className="text-[11px] font-normal text-muted-foreground">
                              {tx.note}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <CategoryBadge categoryId={tx.categoryId || 'autres'} />
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          <span
                            className={
                              tx.amount > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-foreground'
                            }
                          >
                            {formatAmount(tx.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-foreground"
                              onClick={() => startEdit(tx)}
                              title="Modifier cette opération"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => void handleDelete(tx.id)}
                              title="Supprimer cette opération"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
