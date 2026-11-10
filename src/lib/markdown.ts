/**
 * Rendu markdown léger des réponses de l'assistant.
 *
 * Le modèle renvoie fréquemment un paragraphe d'introduction suivi d'une liste
 * sans ligne vide, des listes numérotées, du gras/italique ou des entités HTML.
 * Ce parseur pur transforme le texte en blocs et jetons affichables par React,
 * sans dépendance externe et sans injecter de HTML.
 */

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type MarkdownBlock =
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&euro;': '€',
}

/** Décode les entités HTML que le modèle peut renvoyer dans du texte brut. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|euro|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

/** Le groupe 1 est l'URL : il ne doit pas capturer toute l'alternative. */
const INLINE_PATTERN =
  /(?:\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g

/** Découpe une ligne en texte, gras, italique, code et liens http(s). */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let lastIndex = 0

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, index) })
    }

    const raw = match[0]
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', text: raw.slice(2, -2) })
    } else if (raw.startsWith('`')) {
      tokens.push({ type: 'code', text: raw.slice(1, -1) })
    } else if (raw.startsWith('[')) {
      const label = raw.slice(1, raw.indexOf(']'))
      tokens.push({ type: 'link', text: label, href: match[1] })
    } else {
      tokens.push({ type: 'italic', text: raw.slice(1, -1) })
    }

    lastIndex = index + raw.length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', text }]
}

const BULLET_PATTERN = /^[-*•]\s+(.*)$/
const NUMBERED_PATTERN = /^\d+[.)]\s+(.*)$/
const HEADING_PATTERN = /^#{1,6}\s+(.*)$/
const RULE_PATTERN = /^-{3,}$/

/** Transforme le markdown de l'assistant en blocs prêts à rendre. */
export function parseAssistantMarkdown(raw: string): MarkdownBlock[] {
  const text = decodeEntities(raw.replace(/\r\n/g, '\n'))
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', lines: paragraph.map(parseInline) })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    list = null
  }

  function flush() {
    flushParagraph()
    flushList()
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || RULE_PATTERN.test(line)) {
      flush()
      continue
    }

    const heading = line.match(HEADING_PATTERN)
    if (heading) {
      flushList()
      paragraph.push(heading[1])
      continue
    }

    const bullet = line.match(BULLET_PATTERN)
    if (bullet) {
      flushParagraph()
      if (list?.ordered) flushList()
      list ??= { ordered: false, items: [] }
      list.items.push(bullet[1])
      continue
    }

    const numbered = line.match(NUMBERED_PATTERN)
    if (numbered) {
      flushParagraph()
      if (list && !list.ordered) flushList()
      list ??= { ordered: true, items: [] }
      list.items.push(numbered[1])
      continue
    }

    flushList()
    const quote = line.startsWith('> ') ? line.slice(2) : line
    paragraph.push(quote)
  }

  flush()
  return blocks
}
