import { Skeleton } from '@/components/ui/skeleton'

/** Chargement d'une route découpée, sans saut brutal de mise en page. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Chargement de la page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}
