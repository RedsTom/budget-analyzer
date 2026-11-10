import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
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
import { useVaultStore } from '@/store/vault-store'

export function UnlockScreen() {
  const unlock = useVaultStore((state) => state.unlock)
  const reset = useVaultStore((state) => state.reset)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-12">
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

            <Button type="submit" className="w-full" disabled={submitting}>
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
