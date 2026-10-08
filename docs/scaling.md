# Więcej niż jedna instancja (ARC-4)

Domyślnie canvai działa jako jedna instancja: zdarzenia na żywo w pamięci
procesu, pliki na wolumenie. Do skalowania poziomo (albo wdrożeń bez przestoju)
ustaw na każdej instancji:

| Zmienna | Wartość | Co zmienia |
| --- | --- | --- |
| `LIVE_EVENTS_BUS` | `postgres` | Zdarzenia tablic (scena, materiały, DESIGN.md, komentarze, kursory, obecność) idą przez Postgres LISTEN/NOTIFY — klient połączony z dowolną instancją widzi zmiany z pozostałych. |
| `STORAGE_DRIVER` | `s3` | Pliki w S3 albo Cloudflare R2 zamiast lokalnego wolumenu. |
| `STORAGE_S3_ENDPOINT` | np. `https://<konto>.r2.cloudflarestorage.com` | Endpoint (dla AWS S3 można pominąć). |
| `STORAGE_S3_REGION` | `auto` (R2) albo region AWS | |
| `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | | Bucket prywatny; serwer nie wystartuje w produkcji bez tych wartości. |

Co już jest wspólne bez dodatkowej konfiguracji:

- limity żądań i alerty — w bazie (`rate_limits`, `ops_alerts`);
- kolejka zadań — w bazie, zadanie przejmuje atomowy warunkowy UPDATE (`status = queued`), więc dwie instancje nie wezmą tego samego;
- migracje — z blokadą Lucid; jednorazowy import z SQLite — z blokadą
  `pg_advisory_xact_lock` (importuje tylko pierwsza instancja);
- harmonogram (kopie, maile) — zadanie rezerwuje warunkowy UPDATE w `scheduler_runs`
  (porównanie `last_run_at`), więc uruchamia je jedna instancja.

Przy plikach w S3 kopia zapasowa obejmuje samą bazę — włącz wersjonowanie
bucketa (albo replikację R2), żeby chronić pliki.

Obecność z innych instancji jest odświeżana co 30 s i wygasa po 90 s (padnięta
instancja znika z listy osób na tablicy).
