/**
 * Tri par colonne réutilisable pour les tableaux.
 *
 * Chaque page garde son propre état (`SortState`) et fournit les accesseurs :
 * le premier clic sur une colonne applique `initialDirection`, les clics
 * suivants inversent le sens. Les dates se trient en texte ISO, les montants
 * et compteurs en numérique, les libellés avec `localeCompare('fr')`.
 */

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

/** Bascule le sens si la colonne est déjà active, sinon applique son sens initial. */
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  initial: SortDirection,
): SortState<K> {
  if (current.key !== key) return { key, direction: initial }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/** Copie triée : ne mute jamais le tableau d'origine (issu d'un `useMemo`). */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  accessors: Record<K, (row: T) => string | number>,
): T[] {
  const accessor = accessors[sort.key]
  const factor = sort.direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const left = accessor(a)
    const right = accessor(b)
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * factor
    }
    return String(left).localeCompare(String(right), 'fr', { sensitivity: 'base' }) * factor
  })
}
