/**
 * Silnik autosave sceny — czysty moduł (bez Reacta, bez fetch), testowany
 * w `tests/unit/autosave.spec.ts`. Trzymany w `shared/`, żeby serwer (testy
 * Japa, `#shared/autosave`) i klient (`@shared/autosave`) dzieliły TĘ SAMĄ
 * implementację.
 *
 * Zachowania:
 * - `schedule` debounce'uje zapis: kolejne wywołania restartują timer, więc
 *   szybkie rysowanie koliduje w jeden `save` po ~1 s ciszy.
 * - Sukces zapisu → nowa wersja, status `saved`.
 * - Konflikt (HTTP 409) → pobranie świeżego stanu (`reload`), wywołanie
 *   `onConflict` (komunikat w UI), a następnie JEDEN ponowny zapis z nową
 *   wersją (rebase, last-write-wins z jawnym komunikatem). Kolejny konflikt
 *   kończy się statusem `error` — bez nieskończonej pętli.
 * - Inny błąd (sieć, 422, 500) → status `error`.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Rzucany przez `save` przy konflikcie wersji (HTTP 409). */
export class AutosaveConflictError extends Error {
  constructor(public readonly serverVersion: number) {
    super(`Konflikt wersji sceny (serwer ma wersję ${serverVersion})`)
    this.name = 'AutosaveConflictError'
  }
}

export interface SavePayload<D = unknown, A = unknown> {
  version: number
  document: D
  appState: A
}

/** Świeży stan sceny pobrany z serwera przy konflikcie. */
export interface FreshState<D = unknown, A = unknown> {
  version: number
  document: D
  appState: A
}

export interface AutosaveOptions<D = unknown, A = unknown> {
  debounceMs: number
  /** Zapisuje; zwraca nową wersję; rzuca `AutosaveConflictError` przy 409. */
  save: (payload: SavePayload<D, A>) => Promise<number>
  /** Pobiera świeży stan serwera (przy konflikcie). */
  reload: () => Promise<FreshState<D, A>>
  onStatus: (status: SaveStatus) => void
  onConflict: (fresh: FreshState<D, A>) => void
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
}

export class AutosaveEngine<D = unknown, A = unknown> {
  #version: number
  #timer: ReturnType<typeof setTimeout> | null = null
  #queued: { document: D; appState: A } | null = null
  #inFlight: Promise<void> | null = null
  #disposed = false
  readonly #setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly #clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void

  constructor(
    private readonly opts: AutosaveOptions<D, A>,
    initialVersion: number
  ) {
    this.#version = initialVersion
    this.#setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
    this.#clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h))
  }

  get currentVersion(): number {
    return this.#version
  }

  setVersion(version: number): void {
    this.#version = version
  }

  /** Planuje zapis po ciszy (debounce). Kolejne wywołania restartują timer. */
  schedule(document: D, appState: A): void {
    if (this.#disposed) return
    this.#queued = { document, appState }
    if (this.#timer) this.#clearTimeoutFn(this.#timer)
    this.#timer = this.#setTimeoutFn(() => {
      this.#timer = null
      void this.flush()
    }, this.opts.debounceMs)
  }

  /** Zapisuje natychmiast (pomija debounce). Zwraca obietnicę zakończenia. */
  flush(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#inFlight) return this.#inFlight
    this.#inFlight = this.#run().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  async #run(): Promise<void> {
    while (this.#queued && !this.#disposed) {
      const payload = this.#queued
      this.#queued = null

      this.opts.onStatus('saving')
      try {
        this.#version = await this.opts.save({
          version: this.#version,
          document: payload.document,
          appState: payload.appState,
        })
        this.opts.onStatus('saved')
      } catch (error) {
        if (error instanceof AutosaveConflictError) {
          let fresh: FreshState<D, A> | null = null
          try {
            fresh = await this.opts.reload()
          } catch {
            fresh = null
          }

          if (!fresh) {
            this.opts.onStatus('error')
            continue
          }

          this.#version = fresh.version
          this.opts.onConflict(fresh)

          // Rebase: jeden ponowny zapis z aktualną wersją serwera.
          try {
            this.#version = await this.opts.save({
              version: this.#version,
              document: payload.document,
              appState: payload.appState,
            })
            this.opts.onStatus('saved')
          } catch {
            this.opts.onStatus('error')
          }
        } else {
          this.opts.onStatus('error')
        }
      }
    }
  }

  dispose(): void {
    this.#disposed = true
    if (this.#timer) this.#clearTimeoutFn(this.#timer)
    this.#timer = null
    this.#queued = null
  }
}
