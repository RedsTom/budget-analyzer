import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Check,
  FileUp,
  ExternalLink,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { CsvImporter } from '@/components/csv-importer'
import { testGeminiApiKey } from '@/lib/ai'
import type { ParsedCsvFile } from '@/lib/csv'
import { formatCount } from '@/lib/format'
import { useVaultStore } from '@/store/vault-store'

type Step = 1 | 2 | 3

export function SetupScreen() {
  const setup = useVaultStore((state) => state.setup)
  const [step, setStep] = useState<Step>(1)

  // Étape 1 : mot de passe
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Étape 2 : premier relevé (facultatif)
  const [imports, setImports] = useState<ParsedCsvFile[]>([])

  // Étape 3 : IA opt-in
  const [apiKey, setApiKey] = useState('')
  const [testingKey, setTestingKey] = useState(false)
  const [keyTestedOk, setKeyTestedOk] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)

  const importedRows = imports.reduce((total, file) => total + file.rows.length, 0)
  const importErrors = imports.reduce(
    (total, file) => total + file.errors.length,
    0,
  )

  function handlePasswordNext(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)

    if (password.length < 8) {
      setPasswordError('Choisissez un mot de passe d’au moins 8 caractères.')
      return
    }
    if (password !== confirmation) {
      setPasswordError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setStep(2)
  }

  function handleParsed(file: ParsedCsvFile) {
    setImports((current) => [...current, file])
    toast.success(`${file.sourceFile} : ${formatCount(file.rows.length)} opération(s) prête(s)`)
  }

  async function handleTestKey() {
    if (!apiKey.trim()) {
      setAiError('Veuillez saisir votre clé API.')
      return
    }
    setTestingKey(true)
    setAiError(null)
    setKeyTestedOk(false)
    try {
      const res = await testGeminiApiKey(apiKey.trim())
      if (res.ok) {
        setKeyTestedOk(true)
      } else {
        setAiError(res.error)
      }
    } finally {
      setTestingKey(false)
    }
  }

  async function handleComplete(enableAi: boolean) {
    setSubmitting(true)
    setAiError(null)
    try {
      await setup(
        password,
        {
          enabled: enableAi && Boolean(apiKey.trim()),
          apiKey: enableAi && apiKey.trim() ? apiKey.trim() : undefined,
        },
        imports,
      )
      if (importedRows > 0) {
        toast.success(
          `${formatCount(importedRows)} opération(s) importée(s) dans le coffre chiffré`,
        )
      }
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'Création impossible')
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-muted/40 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-primary)/8%,transparent_60%)]"
      />
      <Card className={`relative w-full ${step === 2 ? 'max-w-2xl' : 'max-w-lg'}`}>
        {step === 1 ? (
          <>
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <LockKeyhole className="size-5" />
              </div>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Créer votre coffre local</CardTitle>
                <Badge variant="outline">Étape 1 sur 3</Badge>
              </div>
              <CardDescription>
                Vos relevés bancaires restent sur cet appareil. Ils sont chiffrés
                avant d’être enregistrés dans le navigateur.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <form className="space-y-4" onSubmit={handlePasswordNext}>
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Au moins 8 caractères"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmation">Confirmer</Label>
                  <Input
                    id="confirmation"
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder="Retapez le mot de passe"
                  />
                </div>

                {passwordError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {passwordError}
                  </p>
                ) : null}

                <Button type="submit" className="w-full">
                  Continuer
                </Button>
              </form>

              <Alert>
                <ShieldCheck />
                <AlertTitle>Aucune récupération possible</AlertTitle>
                <AlertDescription>
                  Le mot de passe n’est jamais stocké. S’il est perdu, les données
                  chiffrées sont définitivement illisibles.
                </AlertDescription>
              </Alert>

              <p className="text-center text-xs text-muted-foreground">
                100 % local et sécurisé sur votre appareil
              </p>
            </CardContent>
          </>
        ) : step === 2 ? (
          <>
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileUp className="size-5" />
              </div>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Importer votre premier relevé</CardTitle>
                <Badge variant="outline">Étape 2 sur 3</Badge>
              </div>
              <CardDescription>
                Déposez un export CSV. Le format habituel est reconnu
                automatiquement ; s’il diffère, vous pourrez associer les colonnes
                aux champs attendus. Cette étape est facultative.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <CsvImporter multiple onParsed={handleParsed} />

              {imports.length > 0 ? (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  {imports.map((file, index) => (
                    <div
                      key={`${file.sourceFile}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="truncate font-medium">{file.sourceFile}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatCount(file.rows.length)} opération(s)
                        {file.errors.length > 0
                          ? ` · ${formatCount(file.errors.length)} ligne(s) ignorée(s)`
                          : ''}
                      </span>
                    </div>
                  ))}
                  <p className="border-t pt-2 text-xs text-muted-foreground">
                    Total : {formatCount(importedRows)} opération(s) prête(s)
                    {importErrors > 0
                      ? ` · ${formatCount(importErrors)} ligne(s) ignorée(s)`
                      : ''}
                    . Le dédoublonnage sera appliqué à la création du coffre.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Vous pouvez aussi créer le coffre maintenant et importer plus tard
                  depuis les réglages.
                </p>
              )}

              <div className="space-y-2">
                <Button type="button" className="w-full" onClick={() => setStep(3)}>
                  {imports.length > 0 ? 'Continuer' : 'Passer l’import'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft className="mr-1 size-3.5" />
                  Retour au mot de passe
                </Button>
              </div>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Assistance IA (Optionnel)</CardTitle>
                <Badge variant="outline">Étape 3 sur 3</Badge>
              </div>
              <CardDescription>
                Activez des suggestions intelligentes pour renommer les marchands
                et commenter vos périodes, via votre propre clé API Google Gemini.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Garanties de confidentialité & fonctionnement :
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    <strong>100 % opt-in :</strong> L’application reste entièrement
                    fonctionnelle sans IA.
                  </li>
                  <li>
                    <strong>Données minimisées :</strong> Seuls les libellés bancaires
                    bruts ou les agrégats de période sont transmis lors d'une action
                    explicite. Aucun solde ni montant personnel.
                  </li>
                  <li>
                    <strong>Sécurité locale :</strong> Votre clé reste chiffrée sur votre appareil
                    et n'est jamais partagée.
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gemini-key">Clé API Google Gemini</Label>
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
                  <Input
                    id="gemini-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value)
                      setKeyTestedOk(false)
                      setAiError(null)
                    }}
                    placeholder="AIzaSy..."
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleTestKey()}
                    disabled={!apiKey.trim() || testingKey}
                  >
                    {testingKey ? 'Test…' : keyTestedOk ? <Check className="size-4 text-emerald-600" /> : 'Tester'}
                  </Button>
                </div>
                {keyTestedOk ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Clé validée avec succès !
                  </p>
                ) : null}
              </div>

              {aiError ? (
                <p className="text-sm text-destructive" role="alert">
                  {aiError}
                </p>
              ) : null}

              <div className="space-y-2 pt-2">
                {apiKey.trim() ? (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={submitting}
                    onClick={() => void handleComplete(true)}
                  >
                    {submitting ? 'Création du coffre…' : 'Activer l’IA et créer le coffre'}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant={apiKey.trim() ? 'outline' : 'default'}
                  className="w-full"
                  disabled={submitting}
                  onClick={() => void handleComplete(false)}
                >
                  {submitting ? 'Création du coffre…' : 'Continuer sans IA (100 % local)'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  disabled={submitting}
                  onClick={() => setStep(2)}
                >
                  <ArrowLeft className="mr-1 size-3.5" />
                  Retour à l’import
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Vous pourrez activer ou modifier cette option à tout moment dans les
                réglages.
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  )
}
