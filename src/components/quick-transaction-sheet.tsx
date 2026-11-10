import { useState, type FormEvent } from 'react'
import { ArrowDownRight, ArrowUpRight, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CATEGORIES } from '@/lib/categories'
import { todayIso } from '@/lib/period'
import type { Transaction } from '@/lib/types'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

type EntryType = 'expense' | 'income'

function QuickTransactionForm({
  initial,
  initialType,
  onDone,
}: {
  initial: Transaction | null
  initialType: EntryType
  onDone: () => void
}) {
  const addManualTransaction = useVaultStore((state) => state.addManualTransaction)
  const updateManualTransaction = useVaultStore(
    (state) => state.updateManualTransaction,
  )
  const deleteManualTransaction = useVaultStore(
    (state) => state.deleteManualTransaction,
  )

  const [type, setType] = useState<EntryType>(
    initial ? (initial.amount < 0 ? 'expense' : 'income') : initialType,
  )
  const [date, setDate] = useState(() => initial?.date ?? todayIso())
  const [amount, setAmount] = useState(
    () => (initial ? String(Math.abs(initial.amount)) : ''),
  )
  const [label, setLabel] = useState(
    () => (initial ? initial.displayName || initial.rawLabel : ''),
  )
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? 'autres')
  const [note, setNote] = useState(initial?.note ?? '')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const parsed = Number.parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Saisissez un montant valide supérieur à 0.')
      return
    }
    if (!label.trim()) {
      toast.error('Indiquez un libellé.')
      return
    }

    const payload = {
      date,
      amount: type === 'expense' ? -parsed : parsed,
      rawLabel: label.trim(),
      displayName: label.trim(),
      categoryId: categoryId === 'autres' ? undefined : categoryId,
      note: note.trim() || undefined,
    }

    setSubmitting(true)
    try {
      if (initial) {
        await updateManualTransaction(initial.id, payload)
        toast.success('Opération mise à jour')
      } else {
        await addManualTransaction(payload)
        toast.success(
          type === 'expense' ? 'Dépense enregistrée' : 'Recette enregistrée',
        )
      }
      onDone()
    } catch {
      toast.error('Enregistrement impossible')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!initial) return
    if (!window.confirm('Supprimer cette opération manuelle ?')) return
    setSubmitting(true)
    try {
      await deleteManualTransaction(initial.id)
      toast.success('Opération supprimée')
      onDone()
    } catch {
      toast.error('Suppression impossible')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => setType('expense')}
          aria-pressed={type === 'expense'}
          className={cn(
            'flex min-h-10 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
            type === 'expense'
              ? 'bg-destructive/10 font-semibold text-destructive shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowDownRight className="size-3.5" />
          Dépense
        </button>
        <button
          type="button"
          onClick={() => setType('income')}
          aria-pressed={type === 'income'}
          className={cn(
            'flex min-h-10 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
            type === 'income'
              ? 'bg-emerald-500/10 font-semibold text-emerald-600 shadow-xs dark:text-emerald-400'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowUpRight className="size-3.5" />
          Recette
        </button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="quick-amount">Montant (€)</Label>
        <Input
          id="quick-amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0,00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoFocus={!initial}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="quick-label">Libellé</Label>
        <Input
          id="quick-label"
          placeholder="Ex : Courses, restaurant, salaire…"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          autoFocus={Boolean(initial)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="quick-category">Catégorie</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="quick-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
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

      <div className="space-y-2">
        <Label htmlFor="quick-date">Date</Label>
        <Input
          id="quick-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="quick-note">
          Note <span className="font-normal text-muted-foreground">(optionnel)</span>
        </Label>
        <Input
          id="quick-note"
          placeholder="Ex : achat en espèces, remboursement…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <SheetFooter className="gap-2">
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting
            ? 'Enregistrement…'
            : initial
              ? 'Enregistrer les modifications'
              : type === 'expense'
                ? 'Enregistrer la dépense'
                : 'Enregistrer la recette'}
        </Button>
        {initial ? (
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={() => void handleDelete()}
            disabled={submitting}
          >
            <Trash2 className="size-4" />
            Supprimer cette opération
          </Button>
        ) : null}
      </SheetFooter>
    </form>
  )
}

/**
 * Saisie rapide partagée : le « + » de la barre mobile l'ouvre sans changer
 * de page, et la page Saisie manuelle l'utilise pour créer ou modifier une
 * opération. Un seul libellé, pas de champ bancaire brut.
 */
export function QuickTransactionSheet() {
  const open = useUiStore((state) => state.quickEntryOpen)
  const editingId = useUiStore((state) => state.quickEntryEditingId)
  const initialType = useUiStore((state) => state.quickEntryInitialType)
  const close = useUiStore((state) => state.closeQuickEntry)
  const transactions = useVaultStore((state) => state.transactions)

  const editing = editingId
    ? (transactions.find((transaction) => transaction.id === editingId) ?? null)
    : null
  const isIncome = editing ? editing.amount > 0 : initialType === 'income'

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>
            {editing
              ? 'Modifier l’opération'
              : isIncome
                ? 'Nouvelle recette'
                : 'Nouvelle dépense'}
          </SheetTitle>
          <SheetDescription>
            {editing
              ? 'Le solde et la couverture seront recalculés automatiquement.'
              : 'Ajout rapide au grand livre, sans passer par un relevé bancaire.'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4">
          <QuickTransactionForm
            key={editing?.id ?? `new-${initialType}`}
            initial={editing}
            initialType={initialType}
            onDone={close}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
