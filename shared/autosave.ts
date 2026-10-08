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
 *   `onConflict`, a następnie JEDEN ponowny zapis z nową wersją. Z opcją
 *   `rebase` zapisywany jest wynik scalenia (zmiany innych osób + lokalne),
 *   bez niej — lokalny dokument (last-write-wins z jawnym komunikatem).
 *   Kolejny konflikt kończy się statusem `error` — bez nieskończonej pętli.
 * - Inny błąd (sieć, 422, 500) → status `error`, a dokument NIE przepada:
 *   wraca do kolejki i zapis jest ponawiany z rosnącym odstępem
 *   (`retryDelaysMs`), a także od razu po `retryNow()` (np. zdarzenie online).
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
  /** Scalenie świeżego stanu serwera z lokalnym (współpraca na żywo). */
  rebase?: (
    fresh: FreshState<D, A>,
    pending: { document: D; appState: A }
  ) => {
    document: D
    appState: A
  }
  /** Po udanym zapisie — co trafiło na serwer i z jaką wersją. */
  onSaved?: (payload: { document: D; appState: A }, version: number) => void
  /** Odstępy kolejnych ponowień po błędzie (ostatni powtarzany). */
  retryDelaysMs?: number[]
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
}

export class AutosaveEngine<D = unknown, A = unknown> {
  #version: number
  #timer: ReturnType<typeof setTimeout> | null = null
  #queued: { document: D; appState: A } | null = null
  #inFlight: Promise<void> | null = null
  #disposed = false
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #failures = 0
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

  /** Czy czeka zaplanowany (jeszcze niewysłany) zapis. */
  get hasPending(): boolean {
    return this.#queued !== null
  }

  /** Czy ostatni zapis się nie udał (i czeka na ponowienie). */
  get failing(): boolean {
    return this.#failures > 0
  }

  /** Ponawia nieudany zapis od razu (np. po powrocie sieci). */
  retryNow(): Promise<void> {
    if (this.#retryTimer) this.#clearTimeoutFn(this.#retryTimer)
    this.#retryTimer = null
    return this.flush()
  }

  /** Nieudany zapis wraca do kolejki (chyba że jest już nowszy stan) i czeka na ponowienie. */
  #fail(payload: { document: D; appState: A }) {
    if (!this.#queued) this.#queued = payload
    this.#failures++
    this.opts.onStatus('error')
    const delays = this.opts.retryDelaysMs ?? [2000, 5000, 10_000, 30_000, 60_000]
    const delay = delays[Math.min(this.#failures - 1, delays.length - 1)]
    if (this.#retryTimer) this.#clearTimeoutFn(this.#retryTimer)
    this.#retryTimer = this.#setTimeoutFn(() => {
      this.#retryTimer = null
      void this.flush()
    }, delay)
  }

  /** Porzuca zaplanowany zapis (np. gdy zdalna wersja już go zawiera). */
  cancelPending(): void {
    if (this.#timer) this.#clearTimeoutFn(this.#timer)
    this.#timer = null
    this.#queued = null
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
        this.opts.onSaved?.(payload, this.#version)
        this.#failures = 0
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
            this.#fail(payload)
            return
          }

          this.#version = fresh.version
          this.opts.onConflict(fresh)
          const next = this.opts.rebase ? this.opts.rebase(fresh, payload) : payload

          // Rebase: jeden ponowny zapis z aktualną wersją serwera.
          try {
            this.#version = await this.opts.save({
              version: this.#version,
              document: next.document,
              appState: next.appState,
            })
            this.opts.onSaved?.(next, this.#version)
            this.#failures = 0
            this.opts.onStatus('saved')
          } catch {
            this.#fail(next)
            return
          }
        } else {
          this.#fail(payload)
          return
        }
      }
    }
  }

  dispose(): void {
    this.#disposed = true
    if (this.#timer) this.#clearTimeoutFn(this.#timer)
    if (this.#retryTimer) this.#clearTimeoutFn(this.#retryTimer)
    this.#timer = null
    this.#retryTimer = null
    this.#queued = null
  }
}
