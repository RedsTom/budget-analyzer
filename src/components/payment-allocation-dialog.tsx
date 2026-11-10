import { useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ArrowDownRight, CalendarClock, Search, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryBadge } from '@/components/category-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { categoryById, categoryIdOf } from '@/lib/categories'
import { formatAmount, formatDate } from '@/lib/format'
import { resolveDisplayName } from '@/lib/labels'
import { allocationCapacity, sortLedger } from '@/lib/runway'
import {
  allocationParts,
  type CustomAllocationPart,
  type Transaction,
} from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function shiftMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(monthKey: string): string {
  return format(parseISO(`${monthKey}-01`), 'MMM yy', { locale: fr })
}

function dayOffset(paymentDate: string, creditDate: string): number {
  return Math.round(
    (new Date(`${creditDate}T00:00:00`).getTime() -
      new Date(`${paymentDate}T00:00:00`).getTime()) /
      86_400_000,
  )
}

interface NearbyCredit {
  transaction: Transaction
  label: string
  available: number
  offsetDays: number
}

export function PaymentAllocationDialog({
  paymentId,
  onClose,
  onSaved,
}: {
  paymentId: string | null
  onClose: () => void
  onSaved: (advance: boolean) => void
}) {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const budgets = useVaultStore((state) => state.budgets)
  const setCoverageAllocationParts = useVaultStore(
    (state) => state.setCoverageAllocationParts,
  )

  const payment = paymentId
    ? (transactions.find((transaction) => transaction.id === paymentId) ?? null)
    : null
  const paymentDate = payment?.date ?? ''
  const total = payment && payment.amount < 0 ? -payment.amount : 0
  const storedParts = allocationParts(
    paymentId ? customAllocations[paymentId] : undefined,
    total,
  )

  const [draft, setDraft] = useState<CustomAllocationPart[]>(storedParts)
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const assignedAmount = round2(draft.reduce((sum, part) => sum + part.amount, 0))
  const remaining = round2(Math.max(0, total - assignedAmount))
  const draftByCredit = useMemo(() => {
    const map = new Map<string, number>()
    for (const part of draft) {
      map.set(part.creditId, round2((map.get(part.creditId) ?? 0) + part.amount))
    }
    return map
  }, [draft])

  const categoryId = payment ? categoryIdOf(payment, aliases) : 'autres'
  const category = categoryById(categoryId)
  const isTransfer = categoryId === 'transferts'
  const paymentMonth = payment?.date.slice(0, 7) ?? ''
  const applicableBudget =
    budgets.find((budget) => budget.categoryId === categoryId) ??
    budgets.find((budget) => !budget.categoryId || budget.categoryId === 'all')

  const budgetMonths = !paymentId || !applicableBudget
    ? []
    : [-1, 0, 1]
        .map((offset) => shiftMonth(paymentMonth, offset))
        .map((key) => {
          const spent = transactions.reduce((sum, transaction) => {
            if (transaction.amount >= 0 || transaction.date.slice(0, 7) !== key) {
              return sum
            }
            if (
              applicableBudget.categoryId &&
              applicableBudget.categoryId !== 'all' &&
              categoryIdOf(transaction, aliases) !== applicableBudget.categoryId
            ) {
              return sum
            }
            return sum - transaction.amount
          }, 0)
          return { key, spent: round2(spent), current: key === paymentMonth }
        })

  const credits: NearbyCredit[] = paymentId
    ? sortLedger(transactions)
        .filter((transaction) => transaction.amount > 0)
        .flatMap((transaction) => {
          const capacity = allocationCapacity(
            transactions,
            customAllocations,
            paymentId,
            transaction.id,
          )
          if (!capacity) return []
          const alreadyDraft = draftByCredit.get(transaction.id) ?? 0
          const available = round2(Math.max(0, capacity.available - alreadyDraft))
          return [
            {
              transaction,
              label: resolveDisplayName(transaction, aliases),
              available,
              offsetDays: dayOffset(paymentDate, transaction.date),
            },
          ]
        })
        .sort(
          (a, b) =>
            Math.abs(a.offsetDays) - Math.abs(b.offsetDays) ||
            a.offsetDays - b.offsetDays ||
            b.transaction.order - a.transaction.order,
        )
    : []

  const creditQuery = search.trim().toLocaleLowerCase('fr-FR')
  const filteredCredits = creditQuery
    ? credits.filter(
        (credit) =>
          credit.label.toLocaleLowerCase('fr-FR').includes(creditQuery) ||
          credit.transaction.rawLabel.toLocaleLowerCase('fr-FR').includes(creditQuery) ||
          credit.transaction.date.includes(creditQuery) ||
          formatAmount(credit.transaction.amount).includes(creditQuery),
      )
    : credits
  const availableCredits = filteredCredits.filter((credit) => credit.available > 0.005)
  const visibleCredits = showAll
    ? filteredCredits
    : (availableCredits.length > 0 ? availableCredits : filteredCredits).slice(0, 8)
  const selectedCredit = filteredCredits.find(
    (credit) => credit.transaction.id === selectedCreditId,
  )

  if (!payment) return null

  const creditLabel = (creditId: string): string => {
    const credit = transactions.find((transaction) => transaction.id === creditId)
    return credit ? resolveDisplayName(credit, aliases) : creditId
  }

  function selectCredit(credit: NearbyCredit) {
    if (credit.available <= 0.005) return
    setSelectedCreditId(credit.transaction.id)
    setAmountInput(String(Math.min(remaining, credit.available)))
  }

  async function persistAndAdvance(
    parts: CustomAllocationPart[],
    advance: boolean,
  ) {
    if (savingRef.current || !payment) return
    savingRef.current = true
    setSaving(true)
    const assigned = round2(parts.reduce((sum, part) => sum + part.amount, 0))
    const left = round2(Math.max(0, total - assigned))
    try {
      await setCoverageAllocationParts(payment.id, parts)
      toast.success(
        parts.length === 0
          ? 'Paiement remis à traiter'
          : left <= 0.005
            ? 'Paiement entièrement affecté'
            : 'Affectation enregistrée',
      )
      onSaved(advance)
    } catch {
      toast.error('Enregistrement impossible')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function save(advance: boolean) {
    void persistAndAdvance(draft, advance)
  }

  function addPart() {
    if (!selectedCredit) return
    const parsed = Number.parseFloat(amountInput.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Saisissez un montant positif.')
      return
    }
    const used = Math.min(parsed, remaining, selectedCredit.available)
    if (used <= 0.005) {
      toast.error('Ce revenu n’a plus de place pour cette dépense.')
      return
    }

    const existing = draft.find(
      (part) => part.creditId === selectedCredit.transaction.id,
    )
    const nextDraft = allocationParts(
      [
        ...draft.filter(
          (part) => part.creditId !== selectedCredit.transaction.id,
        ),
        {
          creditId: selectedCredit.transaction.id,
          amount: round2((existing?.amount ?? 0) + used),
        },
      ],
      total,
    )
    setDraft(nextDraft)
    setSelectedCreditId(null)
    setAmountInput('')

    const nextAssigned = round2(
      nextDraft.reduce((sum, part) => sum + part.amount, 0),
    )
    if (total - nextAssigned <= 0.005) {
      // Paiement entièrement affecté : on enchaîne immédiatement.
      void persistAndAdvance(nextDraft, true)
    }
  }

  function removePart(creditId: string) {
    setDraft((current) => current.filter((part) => part.creditId !== creditId))
    if (selectedCreditId === creditId) {
      setSelectedCreditId(null)
      setAmountInput('')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            Traiter le paiement
            {isTransfer ? <Badge variant="outline">Virement</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            Choisissez un ou plusieurs revenus. Le paiement peut être fractionné.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Où
            </p>
            <p className="block max-w-full truncate text-lg font-semibold">
              {resolveDisplayName(payment, aliases)}
            </p>
            <p className="block max-w-full truncate text-xs text-muted-foreground">
              {payment.rawLabel}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CategoryBadge categoryId={categoryId} />
              <Badge variant="outline" className="text-[10px]">
                {formatDate(payment.date)}
              </Badge>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Montant
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatAmount(total)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatAmount(assignedAmount)} affectés · reste{' '}
              <strong
                className={
                  remaining > 0.005
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }
              >
                {formatAmount(remaining)}
              </strong>
            </p>
          </div>
        </div>

        <Progress value={total > 0 ? (assignedAmount / total) * 100 : 100} className="h-2" />

        {draft.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Affectations prévues</p>
            {draft.map((part) => (
              <div
                key={part.creditId}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{creditLabel(part.creditId)}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatAmount(part.amount)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Retirer ${creditLabel(part.creditId)}`}
                  onClick={() => removePart(part.creditId)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Wallet className="size-4" />
                Revenus proches dans le temps
              </p>
              <p className="text-xs text-muted-foreground">
                Avant ou après le paiement, les plus proches d’abord. Toutes les
                entrées restent accessibles.
              </p>
            </div>
            <Badge variant="outline">
              {filteredCredits.length} entrée{filteredCredits.length > 1 ? 's' : ''} ·{' '}
              {availableCredits.length} disponible
              {availableCredits.length > 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un revenu, une date, un montant…"
              className="pl-8"
            />
          </div>

          {visibleCredits.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Aucun revenu ne correspond à cette recherche.
            </p>
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border">
              {visibleCredits.map((credit) => {
                const selected = selectedCreditId === credit.transaction.id
                return (
                  <div key={credit.transaction.id} className={cn(selected && 'bg-primary/5')}>
                    <button
                      type="button"
                      onClick={() => selectCredit(credit)}
                      disabled={credit.available <= 0.005}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{credit.label}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              credit.offsetDays > 0 &&
                                'border-amber-500/40 text-amber-700 dark:text-amber-400',
                            )}
                          >
                            {credit.offsetDays === 0
                              ? 'même jour'
                              : credit.offsetDays < 0
                                ? `${Math.abs(credit.offsetDays)} j avant`
                                : `${credit.offsetDays} j après`}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDate(credit.transaction.date)} ·{' '}
                          {formatAmount(credit.transaction.amount)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] text-muted-foreground">
                          {credit.available > 0.005 ? 'disponible' : 'complet'}
                        </p>
                        <p
                          className={cn(
                            'text-base font-semibold tabular-nums',
                            credit.available > 0.005
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {formatAmount(credit.available)}
                        </p>
                      </div>
                      <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    {selected ? (
                      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-3 py-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0.01"
                          max={Math.min(remaining, credit.available)}
                          value={amountInput}
                          onChange={(event) => setAmountInput(event.target.value)}
                          className="w-32"
                          aria-label={`Montant à affecter à ${credit.label}`}
                          autoFocus
                        />
                        <span className="text-xs text-muted-foreground">
                          max {formatAmount(Math.min(remaining, credit.available))}
                        </span>
                        <Button type="button" size="sm" onClick={addPart}>
                          Ajouter
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {showAll || filteredCredits.length > visibleCredits.length ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? 'Réduire aux revenus les plus proches'
                : `Afficher toutes les entrées (${filteredCredits.length})`}
            </Button>
          ) : null}
        </div>

        {applicableBudget && budgetMonths.length > 0 ? (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarClock className="size-4" />
              Budget {applicableBudget.categoryId ? category.name : 'global'} autour du paiement
            </p>
            <div className="grid grid-cols-3 gap-2">
              {budgetMonths.map((month) => {
                const over = month.spent > applicableBudget.monthlyLimit
                return (
                  <div
                    key={month.key}
                    className={cn(
                      'rounded-lg border bg-card p-2',
                      month.current && 'border-primary/50 ring-1 ring-primary/20',
                    )}
                  >
                    <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {monthLabel(month.key)}
                    </p>
                    <p
                      className={cn(
                        'mt-1 text-xs font-semibold tabular-nums',
                        over ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {formatAmount(month.spent)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      sur {formatAmount(applicableBudget.monthlyLimit)}
                    </p>
                    <Progress
                      value={Math.min(
                        100,
                        applicableBudget.monthlyLimit > 0
                          ? (month.spent / applicableBudget.monthlyLimit) * 100
                          : 100,
                      )}
                      className="mt-1 h-1"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Aucun budget défini pour la catégorie {category.name} ou globalement.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving}>
            Enregistrer
          </Button>
          <Button onClick={() => void save(true)} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer et suivant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
