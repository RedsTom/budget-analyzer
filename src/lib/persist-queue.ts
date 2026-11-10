export interface WriteQueue {
  /** Demande une écriture et résout après celle qui contient cette mutation. */
  schedule: () => Promise<void>
  /** Attend la fin de toutes les écritures en attente. */
  flush: () => Promise<void>
  isIdle: () => boolean
}

/**
 * File d'écriture à coalescence :
 * - une seule écriture à la fois ;
 * - les mutations arrivées pendant une écriture déclenchent un tour
 *   supplémentaire avec la snapshot la plus récente ;
 * - les appelants sont résolus par l'écriture qui inclut leur mutation.
 */
export function createWriteQueue(write: () => Promise<void>): WriteQueue {
  let running: Promise<void> | null = null
  let dirty = false
  let waiters: { resolve: () => void; reject: (reason: unknown) => void }[] = []
  let lastError: unknown = null

  async function drain(): Promise<void> {
    while (dirty) {
      dirty = false
      const batch = waiters
      waiters = []
      try {
        await write()
        lastError = null
        for (const waiter of batch) waiter.resolve()
      } catch (error) {
        lastError = error
        for (const waiter of batch) waiter.reject(error)
      }
    }
    running = null
  }

  function schedule(): Promise<void> {
    dirty = true
    const promise = new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject })
    })
    if (!running) running = drain()
    return promise
  }

  async function flush(): Promise<void> {
    if (running) await running
    if (dirty) await schedule()
    if (lastError) throw lastError
  }

  return {
    schedule,
    flush,
    isIdle: () => !running && !dirty,
  }
}
