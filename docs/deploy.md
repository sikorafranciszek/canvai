# Wdrożenia (REL-6)

Push na `main` uruchamia CI (`.github/workflows/ci.yml`):

1. typecheck, testy jednostkowe, funkcjonalne i e2e na PostgreSQL;
2. **Build jak w Dockerfile** — `node ace codegen && node ace build` z atrapami
   env z Dockerfile i limitem 5 minut (zawieszony build nie wisi w Coolify bez logu);
3. **deploy** — tylko po zielonych testach na `main`: wywołanie API Coolify.

## Włączenie automatycznego wdrożenia

W repozytorium GitHub → Settings → Secrets and variables → Actions dodaj:

| Sekret | Wartość |
| --- | --- |
| `COOLIFY_URL` | adres panelu Coolify, np. `https://coolify.example.com` |
| `COOLIFY_TOKEN` | token API Coolify z uprawnieniem `deploy` |
| `COOLIFY_APP_UUID` | UUID aplikacji canvai w Coolify |

Bez tych sekretów krok `deploy` kończy się informacją i nic nie wdraża — jak
dotąd wdrażasz ręcznie z panelu. W Coolify wyłącz „Auto Deploy” z webhooka
GitHuba, żeby wdrożenie nie startowało przed zakończeniem testów.

Job `deploy` używa środowiska GitHub `production` — można w nim włączyć
wymagane zatwierdzenie (Required reviewers), jeśli wdrożenie ma czekać na klik.
