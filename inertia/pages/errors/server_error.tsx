import { Head } from '@inertiajs/react'
import { RotateCw } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'

export default function ServerError() {
  return (
    <div className="error-page">
      <Head title="Błąd serwera" />
      <div className="error-page__inner">
        <Brand />
        <div className="error-page__code">500</div>
        <h1 className="t-title">Coś poszło nie tak</h1>
        <p className="t-muted">
          Wystąpił nieoczekiwany błąd po naszej stronie. Twoje dane są bezpieczne — spróbuj ponownie
          za chwilę.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 8 }}
          onClick={() => window.location.reload()}
        >
          <RotateCw />
          Odśwież stronę
        </button>
      </div>
    </div>
  )
}
