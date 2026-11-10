import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from 'cn'
import { TableHead } from '@/components/ui/table'
import type { SortDirection, SortState } from '@/lib/table-sort'

export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  initialDirection = 'asc',
  align = 'left',
  className,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (key: K, initial: SortDirection) => void
  /** Sens du premier clic sur cette colonne. */
  initialDirection?: SortDirection
  align?: 'left' | 'right'
  className?: string
}) {
  const active = sort.key === sortKey
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown

  return (
    <TableHead
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey, initialDirection)}
        className={cn(
          'inline-flex w-full items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        <span className="truncate">{label}</span>
        <Icon
          className={cn('size-3 shrink-0', active ? 'opacity-100' : 'opacity-40')}
          aria-hidden
        />
      </button>
    </TableHead>
  )
}
