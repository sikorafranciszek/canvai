import { Head } from '@inertiajs/react'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'

export default function NotFound() {
  return (
    <div className="error-page">
      <Head title="Nie znaleziono" />
      <div className="error-page__inner">
        <Brand />
        <div className="error-page__code">404</div>
        <h1 className="t-title">Nie znaleziono strony</h1>
        <p className="t-muted">
          Adres mógł się zmienić albo tablica została usunięta. Sprawdź link lub wróć do listy
          tablic.
        </p>
        <a href="/boards" className="btn btn--primary" style={{ marginTop: 8 }}>
          <ArrowLeft />
          Wróć do tablic
        </a>
      </div>
    </div>
  )
}
