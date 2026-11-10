import { categoryById } from '@/lib/categories'
import { cn } from 'cn'

export function CategoryBadge({
  categoryId,
  className,
  subtle = false,
}: {
  categoryId: string | undefined
  className?: string
  subtle?: boolean
}) {
  const category = categoryById(categoryId)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{
        backgroundColor: subtle ? undefined : `${category.color}1a`,
        color: subtle ? undefined : category.color,
        border: subtle ? '1px solid var(--border)' : undefined,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: category.color }} />
      {category.name}
    </span>
  )
}
