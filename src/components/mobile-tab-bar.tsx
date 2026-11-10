import { Ellipsis, Lock, Plus } from 'lucide-react'
import { InstallCard } from '@/components/pwa/install-card'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { MOBILE_TABS, MORE_ROUTES } from '@/app/routes'
import { navigate, type PageId } from '@/lib/router'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

export function MobileTabBar({ page }: { page: PageId }) {
  const moreActive = !MOBILE_TABS.some((route) => route.id === page)
  const requestNewExpense = useUiStore((state) => state.requestNewExpense)
  const lock = useVaultStore((state) => state.lock)

  function renderTab(route: (typeof MOBILE_TABS)[number]) {
    const Icon = route.icon
    const active = page === route.id
    return (
      <button
        key={route.id}
        type="button"
        onClick={() => navigate(route.id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
          active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="size-5" />
        <span className="max-w-full truncate px-1">{route.shortLabel ?? route.label}</span>
      </button>
    )
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Navigation principale"
      >
        <div className="grid h-14 grid-cols-5">
          {MOBILE_TABS.slice(0, 2).map(renderTab)}

          <button
            type="button"
            onClick={requestNewExpense}
            aria-label="Ajouter une dépense"
            className="relative flex min-h-14 flex-col items-center justify-center text-[10px] font-medium text-primary"
          >
            <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-4 ring-background transition-transform active:scale-95">
              <Plus className="size-6" />
            </span>
            <span className="mt-0.5">Dépense</span>
          </button>

          {MOBILE_TABS.slice(2).map(renderTab)}

          <Sheet key={page}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-current={moreActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Ellipsis className="size-5" />
                <span>Plus</span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[82dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              <SheetHeader>
                <SheetTitle>Toutes les pages</SheetTitle>
                <SheetDescription>
                  Analyses détaillées, organisation et réglages du coffre.
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-1 px-4">
                {MORE_ROUTES.map((route) => {
                  const Icon = route.icon
                  const active = page === route.id
                  return (
                    <SheetClose asChild key={route.id}>
                      <button
                        type="button"
                        onClick={() => {
                          // Radix ferme la feuille dans le même événement.
                          // On repousse la navigation d'une tâche pour que
                          // React ait validé la fermeture avant le changement
                          // de route (sinon la feuille reste ouverte).
                          window.setTimeout(() => navigate(route.id), 0)
                        }}
                        className={cn(
                          'flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground hover:bg-muted',
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{route.label}</span>
                      </button>
                    </SheetClose>
                  )
                })}
              </div>

              <div className="mt-2 space-y-3 border-t px-4 pt-4">
                <InstallCard compact />
                <SheetClose asChild>
                  <Button variant="outline" className="w-full" onClick={() => void lock()}>
                    <Lock className="size-4" />
                    Verrouiller le coffre
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </>
  )
}
