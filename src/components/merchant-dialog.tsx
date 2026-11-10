import { useState } from 'react'
import { Pencil, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CATEGORIES } from '@/lib/categories'
import { batchSuggestMerchantCategories, suggestMerchantName } from '@/lib/ai'
import { aiFailureFromMessage } from '@/lib/ai-errors'
import { guardAiOnline, notifyAiFailure } from '@/lib/ai-notify'
import { useVaultStore } from '@/store/vault-store'

/**
 * Placeholder d'un champ pendant que l'IA le traite : même hauteur et même
 * bordure que `Input`/`SelectTrigger` pour éviter tout saut de mise en page.
 */
function FieldSkeleton({ id, label }: { id: string; label: string }) {
  return (
    <div
      id={id}
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex h-8 w-full items-center rounded-lg border border-input px-2.5"
    >
      <Skeleton className="h-3.5 w-40" />
    </div>
  )
}

interface MerchantDialogProps {
  merchantKey: string | null
  initialLabel: string
  initialCategoryId: string
  rawLabel?: string
  onClose: () => void
}

export function MerchantDialog({
  merchantKey,
  initialLabel,
  initialCategoryId,
  rawLabel,
  onClose,
}: MerchantDialogProps) {
  const updateMerchant = useVaultStore((state) => state.updateMerchant)
  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const transactions = useVaultStore((state) => state.transactions)
  const [name, setName] = useState(initialLabel)
  const [category, setCategory] = useState(initialCategoryId || 'auto')
  const [submitting, setSubmitting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestingCategory, setSuggestingCategory] = useState(false)

  const labels = merchantKey
    ? transactions
        .filter((transaction) => transaction.merchantKey === merchantKey)
        .slice(-12)
        .map((transaction) => transaction.rawLabel)
    : []
  const canSuggest = aiEnabled && Boolean(aiApiKey) && labels.length > 0

  async function handleSuggest() {
    if (!guardAiOnline(() => void handleSuggest())) return
    setSuggesting(true)
    try {
      const result = await suggestMerchantName(labels, name, aiApiKey)
      if (!result.ok) {
        notifyAiFailure(
          result.failure ?? aiFailureFromMessage(result.error),
          () => void handleSuggest(),
        )
        toast.error(result.error)
        return
      }
      setName(result.value)
      toast.success('Nom suggéré', {
        description: 'Vérifiez-le puis enregistrez : rien n’est appliqué automatiquement.',
      })
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSuggestCategory() {
    if (!merchantKey) return
    if (!guardAiOnline(() => void handleSuggestCategory())) return
    setSuggestingCategory(true)
    try {
      const result = await batchSuggestMerchantCategories(
        [{ key: merchantKey, labels, currentName: name }],
        aiApiKey,
      )
      if (!result.ok) {
        notifyAiFailure(
          result.failure ?? aiFailureFromMessage(result.error),
          () => void handleSuggestCategory(),
        )
        toast.error(result.error)
        return
      }
      const match = result.value.find((entry) => entry.key === merchantKey)
      if (!match) {
        toast.error('Aucune catégorie proposée')
        return
      }
      setCategory(match.categoryId)
      toast.success('Catégorie suggérée', {
        description: 'Vérifiez-la puis enregistrez : rien n’est appliqué automatiquement.',
      })
    } finally {
      setSuggestingCategory(false)
    }
  }

  async function handleSave() {
    if (!merchantKey) return
    setSubmitting(true)
    try {
      await updateMerchant(merchantKey, {
        displayName: name,
        categoryId: category === 'auto' ? '' : category,
      })
      toast.success('Marchand mis à jour', {
        description: 'Le nom et la catégorie s’appliqueront aussi aux futurs imports.',
      })
      onClose()
    } catch {
      toast.error('Enregistrement impossible')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={merchantKey !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" />
            Modifier le marchand
          </DialogTitle>
          <DialogDescription>
            Le libellé bancaire d’origine reste conservé. Le nom et la catégorie
            s’appliquent à toutes les transactions de ce marchand, y compris aux
            futurs imports.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="merchant-name">Nom simplifié</Label>
              {canSuggest ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void handleSuggest()}
                  disabled={suggesting || suggestingCategory}
                >
                  <Sparkles className="size-3.5" />
                  {suggesting ? 'Suggestion…' : 'Suggérer le nom'}
                </Button>
              ) : null}
            </div>
            {suggesting ? (
              <FieldSkeleton id="merchant-name" label="Suggestion du nom en cours" />
            ) : (
              <Input
                id="merchant-name"
                value={name}
                placeholder="Nom automatique"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave()
                }}
                autoFocus
              />
            )}
            {rawLabel ? (
              <p className="truncate text-xs text-muted-foreground">
                Libellé bancaire : {rawLabel}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="merchant-category">Catégorie</Label>
              {canSuggest ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void handleSuggestCategory()}
                  disabled={suggesting || suggestingCategory}
                >
                  <Sparkles className="size-3.5" />
                  {suggestingCategory ? 'Suggestion…' : 'Suggérer la catégorie'}
                </Button>
              ) : null}
            </div>
            {suggestingCategory ? (
              <FieldSkeleton id="merchant-category" label="Suggestion de la catégorie en cours" />
            ) : (
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="merchant-category" className="w-full">
                  <SelectValue placeholder="Automatique" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatique (d’après le libellé)</SelectItem>
                  {CATEGORIES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Laissez le nom vide pour revenir au libellé nettoyé automatiquement.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={submitting || suggesting || suggestingCategory}
          >
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
