# Kopie zapasowe i odtwarzanie

Kopia robi się codziennie o `BACKUP_HOUR_UTC` (domyślnie 3:00 UTC), o ile ustawione są
zmienne `BACKUP_S3_*`. Ręcznie: `node ace backup:run`, lista: `node ace backup:list`.

## Co jest w kopii

| Co | Gdzie w buckecie | Uwagi |
|---|---|---|
| Baza PostgreSQL | `<prefix><id>/db.dump` | `pg_dump --format=custom`; powyżej 128 MB upload wieloczęściowy |
| Manifest | `<prefix><id>/manifest.json` | lista plików z rozmiarami w chwili kopii |
| Pliki (uploady) | `<prefix>files/<ścieżka>` | wspólna pula; wysyłane tylko nowe i zmienione pliki |

Kopie starsze niż `BACKUP_KEEP_DAYS` (domyślnie 14) są usuwane, najnowsza zostaje zawsze.
Plik w puli jest usuwany dopiero wtedy, gdy nie wskazuje go żaden zachowany manifest.

## Odtworzenie — procedura

1. **Zatrzymaj aplikację** (Coolify → Stop na usłudze `app`). `pg_restore --clean` przy
   działającej aplikacji może trafić na blokady i zostawić bazę w połowie.
2. Uruchom jednorazowy kontener z obrazem aplikacji i tymi samymi zmiennymi (albo
   *Execute command* w Coolify) i sprawdź dostępne kopie:
   ```
   node ace backup:list
   ```
3. Odtwórz wybraną kopię:
   ```
   node ace backup:restore <id> --force
   ```
   - baza: `pg_restore --clean --if-exists --single-transaction` — błąd cofa całość;
   - pliki: dokładnie stan z manifestu — brakujące są pobierane, pliki spoza kopii usuwane;
   - `--db-only` odtwarza samą bazę.
4. Uruchom aplikację; migracje nowsze niż kopia wykonają się przy starcie.
5. Sprawdź `/health/deep` (z `HEALTH_TOKEN`) i otwórz kilka tablic z materiałami.

## Test odtworzenia — co kwartał

- [ ] Utwórz tymczasową bazę (np. drugi kontener `postgres:17`) i katalog na pliki.
- [ ] Uruchom kontener aplikacji wskazujący na nie (`DB_*`, `STORAGE_PATH`) z tymi samymi `BACKUP_S3_*`.
- [ ] `node ace backup:restore <najnowsza> --force`.
- [ ] Porównaj liczbę wierszy w `boards`, `assets`, `design_docs` z produkcją z dnia kopii.
- [ ] Otwórz tablicę i pobierz DESIGN.md; sprawdź, że miniatury się ładują.
- [ ] Zapisz datę testu i czas trwania odtworzenia w notatkach operacyjnych.
