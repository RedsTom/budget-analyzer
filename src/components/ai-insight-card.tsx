import { useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { AiResult } from '@/lib/ai'
import { useVaultStore } from '@/store/vault-store'

type InsightState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string; question?: string }
  | { status: 'error'; error: string }

export interface AiInsightCardProps {
  /** Exécute l'analyse ; la question est fournie quand l'utilisateur en saisit une. */
  onRun: (question?: string) => Promise<AiResult<string>>
  title?: string
  description?: string
  /** Libellé du bouton principal. */
  cta?: string
  /** Texte affiché avant le premier lancement. */
  hint?: string
  /** Questions proposées en un clic. */
  suggestions?: string[]
  /** Affiche un champ de question libre. */
  allowPrompt?: boolean
  placeholder?: string
}

/**
 * Carte d'analyse IA réutilisable (synthèse de période, budgets, trésorerie…).
 * Elle disparaît si l'IA est désactivée : aucune requête n'est émise avant un
 * clic explicite de l'utilisateur.
 */
export function AiInsightCard({
  onRun,
  title = 'Synthèse IA',
  description = 'Générée à la demande via votre clé API. Seuls les agrégats sont transmis.',
  cta = 'Générer',
  hint = 'Demandez un commentaire des chiffres : évolution, poste à surveiller et piste concrète.',
  suggestions,
  allowPrompt = false,
  placeholder = 'Posez une question sur vos chiffres…',
}: AiInsightCardProps) {
  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const [state, setState] = useState<InsightState>({ status: 'idle' })
  const [prompt, setPrompt] = useState('')

  if (!aiEnabled || !aiApiKey) return null

  const loading = state.status === 'loading'

  async function run(question?: string) {
    if (loading) return
    setState({ status: 'loading' })
    const result = await onRun(question?.trim() || undefined)
    setState(
      result.ok
        ? { status: 'done', text: result.value, question: question?.trim() || undefined }
        : { status: 'error', error: result.error },
    )
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 shrink-0 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
            {loading ? 'Analyse…' : state.status === 'idle' ? cta : 'Regénérer'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === 'done' ? (
          <div className="space-y-1">
            {state.question ? (
              <p className="text-xs font-medium text-muted-foreground">{state.question}</p>
            ) : null}
            <p className="text-sm leading-relaxed whitespace-pre-line">{state.text}</p>
          </div>
        ) : state.status === 'error' ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? 'Analyse des agrégats en cours, quelques secondes…' : hint}
          </p>
        )}

        {suggestions && suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 rounded-full border bg-background px-2.5 text-xs"
                disabled={loading}
                onClick={() => {
                  setPrompt(suggestion)
                  void run(suggestion)
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : null}

        {allowPrompt ? (
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault()
              void run(prompt)
            }}
          >
            <Input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={placeholder}
              disabled={loading}
              aria-label="Question à poser à l’IA"
              className="pr-9"
            />
            <Button
              type="submit"
              size="icon-xs"
              variant="ghost"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              aria-label="Envoyer la question"
              disabled={loading || prompt.trim().length === 0}
            >
              <Send className="size-3.5" />
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
