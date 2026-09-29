import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { ArrowLeft } from 'lucide-react'
import type React from 'react'

/** Samodzielna strona tworzenia tablicy (link bezpośredni; w UI jest dialog). */
const BoardsCreate: React.FC = () => {
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <Head title="Nowa tablica" />
      <Link
        route="boards.index"
        className="btn btn--quiet btn--sm"
        style={{ alignSelf: 'flex-start' }}
      >
        <ArrowLeft />
        Tablice
      </Link>
      <div
        className="card"
        style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">Nowa tablica</h1>
          <p className="t-muted">
            Tablica zbiera materiały jednego produktu: zrzuty ekranów, logo, inspiracje i notatki.
          </p>
        </div>
        <Form route="boards.store">
          {({ errors, processing }: { errors: Record<string, string>; processing: boolean }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="field">
                <label className="field__label" htmlFor="title">
                  Nazwa
                </label>
                <input
                  className="input"
                  type="text"
                  name="title"
                  id="title"
                  autoFocus
                  autoComplete="off"
                  placeholder="np. Sklep internetowy — redesign"
                  aria-invalid={errors.title ? 'true' : undefined}
                />
                {errors.title ? <div className="field__error">{errors.title}</div> : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Link route="boards.index" className="btn">
                  Anuluj
                </Link>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  Utwórz tablicę
                </button>
              </div>
            </div>
          )}
        </Form>
      </div>
    </div>
  )
}

export default BoardsCreate
