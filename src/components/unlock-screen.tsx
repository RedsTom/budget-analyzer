import { useState, type FormEvent } from 'react'
import { Fingerprint, KeyRound } from 'lucide-react'
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
  hasPasskey,
  passkeyErrorMessage,
  unlockWithPasskey,
} from '@/lib/passkey'
import { useVaultStore } from '@/store/vault-store'

export function UnlockScreen() {
  const unlock = useVaultStore((state) => state.unlock)
  const reset = useVaultStore((state) => state.reset)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyAvailable] = useState(() => hasPasskey())

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await unlock(password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Déverrouillage impossible')
      setSubmitting(false)
    }
  }

  async function handlePasskey() {
    if (passkeyBusy || submitting) return
    setError(null)
    setPasskeyBusy(true)
    try {
      const recoveredPassword = await unlockWithPasskey()
      await unlock(recoveredPassword)
    } catch (cause) {
      setError(passkeyErrorMessage(cause))
      setPasskeyBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="size-5" />
          </div>
          <CardTitle className="text-xl">Coffre verrouillé</CardTitle>
          <CardDescription>
            Entrez votre mot de passe pour déchiffrer vos relevés.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {passkeyAvailable ? (
            <div className="space-y-3">
              <Button
                type="button"
                className="w-full"
                onClick={() => void handlePasskey()}
                disabled={submitting || passkeyBusy}
              >
                <Fingerprint className="size-4" />
                {passkeyBusy ? 'Vérification…' : 'Déverrouiller avec une clé d’accès'}
              </Button>
              <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground uppercase">
                <span className="h-px flex-1 bg-border" />
                ou avec le mot de passe
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="unlock-password">Mot de passe</Label>
              <Input
                id="unlock-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || passkeyBusy}
            >
              {submitting ? 'Déchiffrement…' : 'Déverrouiller'}
            </Button>
          </form>

          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              if (
                window.confirm(
                  'Supprimer le coffre local ? Cette action est irréversible.',
                )
              ) {
                reset()
              }
            }}
          >
            Mot de passe oublié ? Supprimer le coffre
          </button>
        </CardContent>
      </Card>
    </main>
  )
}
