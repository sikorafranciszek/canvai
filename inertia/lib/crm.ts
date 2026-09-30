/** Wspólne pomocniki CRM: etykiety zdarzeń i normalizacja dat z SQLite/ClickHouse. */

export const EVENT_LABELS: Record<string, string> = {
  page_view: 'Wyświetlenie strony',
  signup: 'Rejestracja',
  email_verified: 'Potwierdzenie e-maila',
  login: 'Logowanie',
  board_created: 'Nowa tablica',
  board_deleted: 'Usunięcie tablicy',
  assets_added: 'Dodanie materiałów',
  design_doc_requested: 'Zlecenie DESIGN.md',
  design_doc_ready: 'DESIGN.md gotowy',
  design_doc_failed: 'DESIGN.md — błąd',
  design_md_downloaded: 'Pobranie DESIGN.md',
  tokens_exported: 'Eksport tokenów',
  preview_requested: 'Zlecenie podglądu UI',
  preview_ready: 'Podgląd UI gotowy',
  preview_failed: 'Podgląd UI — błąd',
  checkout_started: 'Rozpoczęcie płatności',
  purchase: 'Zakup',
  refund: 'Zwrot',
  subscription_changed: 'Zmiana subskrypcji',
  referral_rewarded: 'Bonus za polecenie',
  share_enabled: 'Portal klienta włączony',
  share_disabled: 'Portal klienta wyłączony',
  portal_materials: 'Materiały od klienta',
  portal_feedback: 'Decyzja klienta',
  brand_kit_created: 'Nowy brand kit',
  site_imported: 'Import strony',
  api_token_created: 'Nowy token API',
  mcp_tool_call: 'Wywołanie MCP',
  crm_action: 'Akcja w CRM',
  crm_login: 'Logowanie do CRM',
}

export const STEP_LABELS: Record<string, string> = {
  signup: 'Rejestracja',
  email_verified: 'Potwierdzony e-mail',
  board_created: 'Pierwsza tablica',
  design_doc_ready: 'Pierwszy DESIGN.md',
  purchase: 'Zakup',
}

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

/** SQLite: „YYYY-MM-DD HH:MM:SS” (UTC), ClickHouse: „YYYY-MM-DD HH:MM:SS.mmm” (UTC) → ISO. */
export function iso(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.includes('T')) return value
  return `${value.replace(' ', 'T')}Z`
}

/** Krótki opis właściwości zdarzenia (bez surowego JSON-a). */
export function propsSummary(json: string): string {
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    return Object.entries(p)
      .filter(([, v]) => v !== '' && v != null && typeof v !== 'object')
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ')
  } catch {
    return ''
  }
}
