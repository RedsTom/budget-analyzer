import { useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Check,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Separator } from '@/components/ui/separator'
import { CsvImporter } from '@/components/csv-importer'
import { PageHeader } from '@/components/page-header'
import { testGeminiApiKey } from '@/lib/ai'
import { WrongPasswordError } from '@/lib/crypto'
import type { ParsedCsvFile } from '@/lib/csv'
import { formatDate, formatCount } from '@/lib/format'
import { datasetRange } from '@/lib/period'
import { VAULT_STORAGE_KEY } from '@/lib/storage'
import type { ImportSummary } from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`
}

export function SettingsPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const createdAt = useVaultStore((state) => state.createdAt)
  const lock = useVaultStore((state) => state.lock)
  const reset = useVaultStore((state) => state.reset)
  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const setAiEnabled = useVaultStore((state) => state.setAiEnabled)
  const setAiApiKey = useVaultStore((state) => state.setAiApiKey)
  const importRows = useVaultStore((state) => state.importRows)
  const lastImport = useVaultStore((state) => state.lastImport)

  const [summaries, setSummaries] = useState<ImportSummary[]>([])

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState(aiApiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [aiTestedOk, setAiTestedOk] = useState(false)
  const [savingKey, setSavingKey] = useState(false)

  async function handleAiToggle(enabled: boolean) {
    if (enabled && !aiApiKey && !apiKeyInput.trim()) {
      toast.error('Clé API requise', {
        description: 'Veuillez renseigner votre clé API Google Gemini ci-dessous.',
      })
      return
    }
    await setAiEnabled(enabled)
    toast.success(enabled ? 'Assistance IA activée' : 'Assistance IA désactivée')
  }

  async function handleSaveKey() {
    setSavingKey(true)
    try {
      const trimmed = apiKeyInput.trim()
      await setAiApiKey(trimmed || null)
      if (!trimmed && aiEnabled) {
        await setAiEnabled(false)
      }
      toast.success('Clé API enregistrée de façon chiffrée dans le coffre')
    } finally {
      setSavingKey(false)
    }
  }

  async function handleTestAi() {
    const keyToTest = apiKeyInput.trim() || aiApiKey
    if (!keyToTest) {
      toast.error('Aucune clé API à tester')
      return
    }
    setTestingAi(true)
    setAiTestedOk(false)
    try {
      const res = await testGeminiApiKey(keyToTest)
      if (res.ok) {
        setAiTestedOk(true)
        toast.success('Connexion à l’API Gemini réussie !')
      } else {
        toast.error('Échec du test de l’IA', { description: res.error })
      }
    } finally {
      setTestingAi(false)
    }
  }

  async function handleParsed(file: ParsedCsvFile) {
    const summary = await importRows(file.rows, file.sourceFile, file.errors)
    setSummaries((current) => [...current, summary])
    toast.success(
      `${file.sourceFile} : ${formatCount(summary.added)} ajoutée(s), ${formatCount(
        summary.duplicates,
      )} ignorée(s)`,
      {
        description:
          summary.errors.length > 0
            ? `${formatCount(summary.errors.length)} ligne(s) en erreur — le reste a été importé.`
            : undefined,
      },
    )
  }

  const bounds = datasetRange(transactions)
  const storedBytes = (localStorage.getItem(VAULT_STORAGE_KEY) ?? '').length
  const lastSummary = summaries.at(-1) ?? lastImport
  const decisions = Object.values(recurringDecisions)
  const acceptedRecurring = decisions.filter((decision) => decision === 'accepted').length
  const refusedRecurring = decisions.filter((decision) => decision === 'refused').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Réglages"
        description="Coffre local, import des relevés et sécurité. Aucune donnée ne quitte cet appareil."
        actions={
          <Button variant="outline" size="sm" onClick={lock}>
            <Lock className="size-3.5" />
            Verrouiller
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="size-5" />
            </div>
            <CardTitle>Coffre chiffré</CardTitle>
            <CardDescription>
              AES-256-GCM avec PBKDF2-SHA256 (310 000 itérations). La clé n’existe
              qu’en mémoire tant que le coffre est déverrouillé.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Transactions</dt>
                <dd className="font-medium tabular-nums">{formatCount(transactions.length)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Marchands renommés</dt>
                <dd className="font-medium tabular-nums">{formatCount(Object.keys(aliases).length)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Récurrences acceptées</dt>
                <dd className="font-medium tabular-nums">{formatCount(acceptedRecurring)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Récurrences refusées</dt>
                <dd className="font-medium tabular-nums">{formatCount(refusedRecurring)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Taille stockée</dt>
                <dd className="font-medium tabular-nums">{formatBytes(storedBytes)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Créé le</dt>
                <dd className="font-medium">
                  {createdAt
                    ? format(new Date(createdAt), 'd MMMM yyyy à HH:mm', { locale: fr })
                    : '—'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Historique importé</dt>
                <dd className="font-medium">
                  {transactions.length > 0
                    ? `${formatDate(bounds.start)} → ${formatDate(bounds.end)}`
                    : 'aucune donnée'}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="size-3" />
                Chiffré localement
              </Badge>
              <Badge variant="outline">1 clé localStorage</Badge>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
                <KeyRound className="size-3.5" />
                Changer le mot de passe
              </Button>
              <Button variant="ghost" size="sm" onClick={lock}>
                <Lock className="size-3.5" />
                Verrouiller maintenant
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Importer des relevés</CardTitle>
            <CardDescription>
              Le format est détecté automatiquement. S’il n’est pas reconnu, vous
              pouvez associer les colonnes à la main. Les exports qui se chevauchent
              sont acceptés : une transaction déjà présente n’est jamais comptée deux
              fois.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CsvImporter
              multiple
              onParsed={handleParsed}
            />
            {lastSummary ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Dernier import : {lastSummary.sourceFile}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {formatCount(lastSummary.added)} ajoutée(s) ·{' '}
                  {formatCount(lastSummary.duplicates)} ignorée(s)
                  {lastSummary.errors.length > 0
                    ? ` · ${formatCount(lastSummary.errors.length)} erreur(s)`
                    : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Formats acceptés : CSV séparé par point-virgule, virgule, tabulation
                ou barre verticale. Les colonnes Date, Libellé et Montant (ou
                Débit/Crédit) sont nécessaires ; le solde est reconstruit s’il manque.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <Alert>
        <ShieldCheck />
        <AlertTitle>Aucune récupération de mot de passe</AlertTitle>
        <AlertDescription>
          Le mot de passe n’est jamais stocké, même chiffré. S’il est perdu, le contenu
          du coffre est définitivement illisible. Pensez à exporter vos relevés d’origine.
        </AlertDescription>
      </Alert>

      <Card className={aiEnabled ? 'border-primary/40' : undefined}>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle>Assistance IA</CardTitle>
          <CardDescription>
            Suggestions automatiques de marchands et résumés de vos dépenses via Google Gemini.
            Votre clé reste protégée et chiffrée sur votre appareil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={aiEnabled ? 'secondary' : 'outline'}
              className={aiEnabled ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400' : undefined}
            >
              {aiEnabled ? 'Activée' : 'Désactivée'}
            </Badge>
            {aiApiKey ? (
              <Badge variant="outline" className="text-muted-foreground">
                Clé configurée
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                Clé manquante
              </Badge>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="ai-enabled"
              checked={aiEnabled}
              onCheckedChange={(checked) => void handleAiToggle(checked === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="ai-enabled">Activer l’assistance IA</Label>
              <p className="text-xs text-muted-foreground">
                Totalement optionnel : aucune analyse n’est lancée sans votre accord explicite.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="api-key-input" className="text-sm font-medium">
                Clé API Google Gemini
              </Label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Obtenir une clé gratuite
                <ExternalLink className="size-3" />
              </a>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value)
                    setAiTestedOk(false)
                  }}
                  placeholder="AIzaSy..."
                  className="font-mono text-xs pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showApiKey ? 'Masquer la clé' : 'Afficher la clé'}
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSaveKey()}
                disabled={savingKey || apiKeyInput === (aiApiKey ?? '')}
              >
                {savingKey ? 'Enregistrement…' : 'Enregistrer'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTestAi()}
                disabled={testingAi || (!apiKeyInput.trim() && !aiApiKey)}
              >
                {testingAi ? (
                  'Test…'
                ) : aiTestedOk ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  'Tester'
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1 rounded-lg border bg-muted/10 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Confidentialité & Données :</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <strong>Noms de commerces :</strong> seuls les libellés bancaires
                bruts (sans montant, sans solde, sans info personnelle) sont analysés.
              </li>
              <li>
                <strong>Résumés de période :</strong> uniquement les totaux d'ensemble
                (ex. total des courses du mois).
              </li>
              <li>
                <strong>Sécurité locale :</strong> votre clé est chiffrée sur votre appareil
                avec vos comptes et n’est jamais partagée.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">Zone sensible</CardTitle>
          <CardDescription>
            Supprimer le coffre efface définitivement les transactions, les alias et les
            préférences enregistrées sur cet appareil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="size-3.5" />
                Supprimer le coffre
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer définitivement le coffre ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action est irréversible. Toutes les données chiffrées seront
                  effacées du navigateur. Vos fichiers CSV d’origine ne sont pas modifiés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    reset()
                    toast.success('Coffre supprimé')
                  }}
                >
                  Supprimer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  )
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const changePassword = useVaultStore((state) => state.changePassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function resetFields() {
    setCurrent('')
    setNext('')
    setConfirmation('')
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (next.length < 8) {
      setError('Le nouveau mot de passe doit faire au moins 8 caractères.')
      return
    }
    if (next !== confirmation) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    try {
      await changePassword(current, next)
      toast.success('Mot de passe modifié', {
        description: 'Le coffre a été rechiffré avec une nouvelle clé.',
      })
      resetFields()
      onOpenChange(false)
    } catch (cause) {
      setError(
        cause instanceof WrongPasswordError
          ? 'Le mot de passe actuel est incorrect.'
          : cause instanceof Error
            ? cause.message
            : 'Modification impossible',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) resetFields()
        onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Changer le mot de passe</DialogTitle>
          <DialogDescription>
            Le coffre sera rechiffré avec une nouvelle clé dérivée. Vos données restent
            identiques.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="current-password">Mot de passe actuel</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Nouveau mot de passe</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              placeholder="Au moins 8 caractères"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              resetFields()
              onOpenChange(false)
            }}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Rechiffrement…' : 'Changer le mot de passe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
