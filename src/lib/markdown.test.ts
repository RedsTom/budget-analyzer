import { describe, expect, it } from 'vitest'
import { decodeEntities, parseAssistantMarkdown, parseInline } from './markdown'

describe('parseInline', () => {
  it('reconnaît gras, italique, code et lien', () => {
    const tokens = parseInline('**600 €** puis *bientôt* et `code` [lien](https://exemple.fr)')
    expect(tokens.map((token) => token.type)).toEqual([
      'bold',
      'text',
      'italic',
      'text',
      'code',
      'text',
      'link',
    ])
    expect(tokens[0]).toEqual({ type: 'bold', text: '600 €' })
    expect(tokens.at(-1)).toEqual({
      type: 'link',
      text: 'lien',
      href: 'https://exemple.fr',
    })
  })

  it('ignore un lien non http et le laisse en texte', () => {
    const tokens = parseInline('[lien](javascript:alert(1))')
    expect(tokens).toEqual([{ type: 'text', text: '[lien](javascript:alert(1))' }])
  })
})

describe('parseAssistantMarkdown', () => {
  it('sépare une introduction collée à une liste de puces', () => {
    const blocks = parseAssistantMarkdown(
      'Voici les virements :\n* **600 €** le 26/09\n* **500 €** le 17/10',
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false })
    if (blocks[1].type !== 'list') return
    expect(blocks[1].items).toHaveLength(2)
    expect(blocks[1].items[0][0]).toMatchObject({ type: 'bold', text: '600 €' })
  })

  it('reconnaît les listes numérotées et les puces mélangées', () => {
    const blocks = parseAssistantMarkdown('1. Premier\n2. Second\n\n- Puce A\n- Puce B')
    expect(blocks.map((block) => block.type)).toEqual(['list', 'list'])
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true })
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false })
  })

  it('garde les paragraphes multilignes et retire les titres markdown', () => {
    const blocks = parseAssistantMarkdown('## Synthèse\nPremière ligne\nDeuxième ligne')
    expect(blocks).toHaveLength(1)
    if (blocks[0].type !== 'paragraph') return
    expect(blocks[0].lines).toHaveLength(3)
    expect(blocks[0].lines[0]).toEqual([{ type: 'text', text: 'Synthèse' }])
  })

  it('décode les entités HTML', () => {
    expect(decodeEntities('600&nbsp;€ &amp; plus')).toBe('600 € & plus')
  })
})
