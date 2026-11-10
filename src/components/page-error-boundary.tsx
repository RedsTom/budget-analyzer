import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, Lock, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVaultStore } from '@/store/vault-store'

interface ErrorBoundaryState {
  error: Error | null
}

/** Isole une page fautive : le reste du shell et le coffre restent utilisables. */
export class PageErrorBoundary extends Component<
  { children: ReactNode; page: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[page:${this.props.page}]`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert className="size-6" />
        </div>
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Cette page n’a pas pu s’afficher</h1>
          <p className="text-sm text-muted-foreground">
            Vos données sont intactes. Vous pouvez réessayer ou verrouiller le coffre.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => this.setState({ error: null })}>
            <RotateCcw className="size-4" />
            Réessayer
          </Button>
          <Button variant="outline" onClick={() => useVaultStore.getState().lock()}>
            <Lock className="size-4" />
            Verrouiller
          </Button>
        </div>
      </div>
    )
  }
}
