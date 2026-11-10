import { describe, expect, it } from 'vitest'
import { createWriteQueue } from './persist-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createWriteQueue', () => {
  it('sérialise les écritures et coalesce les mutations arrivées pendant une écriture', async () => {
    const writes: number[] = []
    const pending: ReturnType<typeof deferred>[] = []

    const queue = createWriteQueue(async () => {
      writes.push(writes.length + 1)
      const gate = deferred()
      pending.push(gate)
      await gate.promise
    })

    const first = queue.schedule()
    const second = queue.schedule()

    expect(writes).toEqual([1])
    expect(queue.isIdle()).toBe(false)

    pending[0].resolve()
    await first
    // Le second tour démarre dès la fin de la première écriture ; il est
    // toujours en attente de sa propre résolution.
    expect(writes).toEqual([1, 2])

    pending[1].resolve()
    await second
    expect(queue.isIdle()).toBe(true)
  })

  it('rejette les appelants de l’écriture en échec et permet une reprise', async () => {
    let shouldFail = true
    let attempts = 0
    const queue = createWriteQueue(async () => {
      attempts += 1
      if (shouldFail) throw new Error('quota')
    })

    await expect(queue.schedule()).rejects.toThrow('quota')
    expect(attempts).toBe(1)

    shouldFail = false
    await expect(queue.schedule()).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })

  it('flush attend la dernière écriture', async () => {
    const gate = deferred()
    let done = false
    const queue = createWriteQueue(async () => {
      await gate.promise
      done = true
    })

    void queue.schedule()
    const flushing = queue.flush()
    expect(done).toBe(false)
    gate.resolve()
    await flushing
    expect(done).toBe(true)
    expect(queue.isIdle()).toBe(true)
  })
})
