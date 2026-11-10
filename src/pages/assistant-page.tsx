import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, Send, Sparkles } from 'lucide-react'
import { AssistantArtifacts } from '@/components/assistant-artifacts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePeriod } from '@/hooks/use-period'
import { askAssistantWithTools } from '@/lib/ai'
import { aiFailureFromMessage } from '@/lib/ai-errors'
import { guardAiOnline, notifyAiFailure } from '@/lib/ai-notify'
import type { AssistantToolContext } from '@/lib/assistant-tools'
import { parseAssistantMarkdown, type InlineToken } from '@/lib/markdown'
import { navigate } from '@/lib/router'
import type { AssistantChatMessage } from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'

const SUGGESTIONS = [
  'Où part mon argent sur cette période ?',
  'Montre-moi les virements les plus importants',
  'Compare mes dépenses avec la période précédente',
  'Quels abonnements puis-je couper ?',
  'Mon solde tient-il jusqu’au prochain revenu ?',
  'Quels budgets sont dépassés ?',
]

function createMessageId(role: AssistantChatMessage['role']): string {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${role}:${suffix}`
}

/** Rend les jetons d'une ligne : gras, italique, code, lien. */
function InlineTokens({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'bold':
            return (
              <strong key={index} className="font-semibold">
                {token.text}
              </strong>
            )
          case 'italic':
            return <em key={index}>{token.text}</em>
          case 'code':
            return (
              <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {token.text}
              </code>
            )
          case 'link':
            return (
              <a
                key={index}
                href={token.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {token.text}
              </a>
            )
          default:
            return <Fragment key={index}>{token.text}</Fragment>
        }
      })}
    </>
  )
}

/**
 * Markdown léger : paragraphes, listes à puces ou numérotées même collées à
 * une phrase d'introduction, gras, italique, code et liens. Le texte brut du
 * modèle ne doit jamais afficher ses astérisques ou ses entités HTML.
 */
function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => parseAssistantMarkdown(text), [text])

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List
              key={blockIndex}
              className={
                block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-4'
              }
            >
              {block.items.map((item, index) => (
                <li key={index}>
                  <InlineTokens tokens={item} />
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={blockIndex}>
            {block.lines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 ? <br /> : null}
                <InlineTokens tokens={line} />
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

/**
 * Assistant conversationnel à outils : la conversation est persistée dans le
 * coffre chiffré et n'est effacée que par « Nouveau chat ». Les réponses
 * peuvent contenir des cartes d'opérations cliquables et des graphiques.
 */
export function AssistantPage() {
  const transactions = useVaultStore((state) => state.transactions)
  const aliases = useVaultStore((state) => state.aliases)
  const recurringDecisions = useVaultStore((state) => state.recurringDecisions)
  const budgets = useVaultStore((state) => state.budgets)
  const customAllocations = useVaultStore((state) => state.customAllocations)
  const aiEnabled = useVaultStore((state) => state.aiEnabled)
  const aiApiKey = useVaultStore((state) => state.aiApiKey)
  const assistantChat = useVaultStore((state) => state.assistantChat)
  const appendAssistantChat = useVaultStore((state) => state.appendAssistantChat)
  const clearAssistantChat = useVaultStore((state) => state.clearAssistantChat)
  const { range, previous, label } = usePeriod()

  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const context = useMemo<AssistantToolContext>(
    () => ({
      transactions,
      aliases,
      range,
      label,
      previousRange: previous,
      budgets,
      customAllocations,
      recurringDecisions,
    }),
    [transactions, aliases, range, label, previous, budgets, customAllocations, recurringDecisions],
  )

  const loading = pending !== null

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [assistantChat, pending, error])

  async function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    if (!guardAiOnline(() => void ask(trimmed))) return

    setError(null)
    setQuestion('')
    setPending(trimmed)

    // Le message utilisateur est enregistré avant l'appel : il survit à un
    // rechargement même si le service d'IA échoue.
    await appendAssistantChat([
      {
        id: createMessageId('user'),
        role: 'user',
        text: trimmed,
        createdAt: new Date().toISOString(),
      },
    ])

    const result = await askAssistantWithTools({
      question: trimmed,
      history: assistantChat,
      context,
      apiKey: aiApiKey,
    })

    setPending(null)

    if (!result.ok) {
      notifyAiFailure(
        result.failure ?? aiFailureFromMessage(result.error),
        () => void ask(trimmed),
      )
      setError(result.error)
      return
    }

    await appendAssistantChat([
      {
        id: createMessageId('assistant'),
        role: 'assistant',
        text: result.value.text,
        createdAt: new Date().toISOString(),
        artifacts: result.value.artifacts.length > 0 ? result.value.artifacts : undefined,
      },
    ])
  }

  if (!aiEnabled || !aiApiKey) {
    return (
      <div className="space-y-6">
        <DisabledHeader />
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              IA désactivée
            </CardTitle>
            <CardDescription>
              Activez l’assistant et renseignez une clé API dans les réglages. Aucune donnée n’est
              envoyée tant que vous ne posez pas de question.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={() => navigate('settings')}>
              Ouvrir les réglages
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const lastUserMessage = [...assistantChat].reverse().find((message) => message.role === 'user')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Assistant</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} · l’assistant peut chercher une opération précise et afficher des graphiques.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setError(null)
            setPending(null)
            void clearAssistantChat()
          }}
          disabled={loading || (assistantChat.length === 0 && !error)}
        >
          <Eraser className="size-3.5" />
          Nouveau chat
        </Button>
      </div>

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-4 py-4">
          {assistantChat.length === 0 && !pending ? (
            <div className="mx-auto w-full max-w-2xl pb-6 text-center">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-4" />
              </div>
              <p className="mt-3 font-heading text-lg font-medium">Que voulez-vous regarder ?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                L’assistant interroge vos données locales pour {label.toLocaleLowerCase('fr-FR')} :
                opérations, marchands, budgets, récurrences et trésorerie.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto rounded-full px-3 py-1.5 text-left text-xs whitespace-normal"
                    disabled={loading}
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {assistantChat.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[min(36rem,85%)] rounded-2xl bg-primary px-3.5 py-2 text-sm whitespace-pre-line text-primary-foreground">
                  {message.text}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                <div className="w-full max-w-[min(46rem,100%)] rounded-2xl border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
                  <MarkdownText text={message.text} />
                  <AssistantArtifacts artifacts={message.artifacts} />
                </div>
              </div>
            ),
          )}

          {pending ? (
            <div className="flex justify-start" aria-live="polite">
              <p className="flex items-center gap-2 rounded-2xl border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
                <Sparkles className="size-3.5 animate-pulse" />
                Analyse en cours…
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <p className="text-sm text-destructive">{error}</p>
              {lastUserMessage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={loading}
                  onClick={() => void ask(lastUserMessage.text)}
                >
                  Réessayer
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="shrink-0 border-t bg-background/80 pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(question)
        }}
      >
        <div className="relative">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void ask(question)
              }
            }}
            rows={1}
            disabled={loading}
            placeholder="Posez une question ou demandez une opération précise…"
            aria-label="Question à l’assistant"
            className="max-h-32 min-h-12 w-full resize-none rounded-2xl border border-input bg-background py-3 pr-12 pl-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon-sm"
            className="absolute right-2 bottom-2"
            aria-label="Envoyer la question"
            disabled={loading || question.trim().length === 0}
          >
            <Send className="size-3.5" />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Les données utiles à votre question (opérations, montants, budgets) sont envoyées au
          service d’IA à votre demande. La conversation reste chiffrée dans ce navigateur.
        </p>
      </form>
    </div>
  )
}

/** En-tête minimal pour l'écran « IA désactivée ». */
function DisabledHeader() {
  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Assistant</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Posez une question libre sur vos données locales. L’assistant est désactivé tant que
        l’option n’est pas activée.
      </p>
    </div>
  )
}
