import { Suspense, useEffect, useRef, type ComponentType } from 'react'
import { Loader2, Lock, ShieldCheck, Wallet, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DetailHost } from '@/components/entity-panels'
import { EmptyVault } from '@/components/empty-vault'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { PageErrorBoundary } from '@/components/page-error-boundary'
import { PageSkeleton } from '@/components/page-skeleton'
import { PeriodPicker } from '@/components/period-picker'
import { QuickTransactionSheet } from '@/components/quick-transaction-sheet'
import { NAV_GROUPS, ROUTE_BY_ID } from '@/app/routes'
import { useOnline } from '@/hooks/use-online'
import { usePage, navigate, type PageId } from '@/lib/router'
import { datasetRange } from '@/lib/period'
import { formatCount, formatDate } from '@/lib/format'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

export function AppShell() {
  const page = usePage()
  const route = ROUTE_BY_ID[page]
  const online = useOnline()
  const vaultError = useVaultStore((state) => state.error)
  const retrySave = useVaultStore((state) => state.retrySave)
  const closeQuickEntry = useUiStore((state) => state.closeQuickEntry)
  const mainRef = useRef<HTMLElement>(null)
  const wasOnline = useRef(online)

  // Le shell disparaît au verrouillage : ne pas rouvrir la feuille de saisie
  // au déverrouillage suivant.
  useEffect(() => () => closeQuickEntry(), [closeQuickEntry])

  useEffect(() => {
    if (wasOnline.current === online) return
    wasOnline.current = online
    if (online) toast.success('Connexion rétablie')
  }, [online])

  // Changer de page ferme le panneau de détail, y compris via l'historique.
  useEffect(() => {
    const onHashChange = () => useUiStore.getState().closeDetail()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    document.title = `${route.label} — Budget Analyzer`
    mainRef.current?.scrollTo({ top: 0 })
  }, [route.label])

  return (
    <div className="flex h-dvh flex-col bg-muted/25">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <SidebarContent page={page} />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 shrink-0 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 lg:px-8">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium lg:hidden">{route.label}</p>
              <p className="hidden text-[11px] font-medium tracking-wide text-muted-foreground uppercase lg:block">
                {route.group}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <SavingIndicator />
              <PeriodPicker />
            </div>
          </div>

          {!online ? (
            <div className="flex items-center justify-center gap-2 border-t border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-300">
              <WifiOff className="size-3.5 shrink-0" />
              Hors ligne — les analyses locales restent disponibles.
            </div>
          ) : null}

          {vaultError ? (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
              <span>{vaultError}</span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void retrySave()}
              >
                Réessayer
              </Button>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            ref={mainRef}
            className={cn(
              'min-h-0 min-w-0 flex-1 px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-0',
              page === 'assistant'
                ? 'flex overflow-hidden pt-4'
                : 'overflow-y-auto pt-4 lg:pt-6',
            )}
          >
            <div
              className={cn(
                'mx-auto w-full max-w-7xl',
                page === 'assistant' && 'flex min-h-0 flex-1 flex-col',
              )}
            >
              <PageErrorBoundary key={page} page={page}>
                <PageOutlet page={page} />
              </PageErrorBoundary>
            </div>
          </main>
          <DetailHost />
        </div>
      </div>

      <MobileTabBar page={page} />
      <QuickTransactionSheet />
    </div>
  )
}

function SavingIndicator() {
  const saving = useVaultStore((state) => state.saving)
  const error = useVaultStore((state) => state.error)

  if (!saving && !error) return null

  return (
    <span
      className="flex items-center gap-1 text-[11px] text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {saving ? (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <span className="hidden sm:inline">Sauvegarde…</span>
        </>
      ) : (
        <span className="size-2 rounded-full bg-destructive" aria-label="Erreur de sauvegarde" />
      )}
    </span>
  )
}

function SidebarContent({
  page,
  onNavigate,
}: {
  page: PageId
  onNavigate?: () => void
}) {
  const transactions = useVaultStore((state) => state.transactions)
  const lock = useVaultStore((state) => state.lock)
  const bounds = datasetRange(transactions)

  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </div>
          <div>
            <p className="font-heading text-sm leading-tight font-medium">Budget Analyzer</p>
            <p className="text-xs text-muted-foreground">100 % local</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Historique</p>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              <ShieldCheck className="size-2.5" />
              chiffré
            </Badge>
          </div>
          <p className="mt-1 text-sm font-medium">
            {formatCount(transactions.length)} mouvement{transactions.length > 1 ? 's' : ''}
          </p>
          {transactions.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {formatDate(bounds.start)} → {formatDate(bounds.end)}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">aucune donnée importée</p>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = page === item.id
                const Icon = item.icon as ComponentType<{ className?: string }>
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigate(item.id)
                      onNavigate?.()
                    }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="truncate">{item.label}</span>
                    {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Coffre chiffré local
        </div>
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={lock}>
          <Lock className="size-3.5" />
          Verrouiller
        </Button>
      </div>
    </div>
  )
}

function PageOutlet({ page }: { page: PageId }) {
  const route = ROUTE_BY_ID[page]
  const hasData = useVaultStore((state) => state.transactions.length > 0)

  if (route.requiresData && !hasData) return <EmptyVault />

  const Component = route.component
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Component key={page} />
    </Suspense>
  )
}
