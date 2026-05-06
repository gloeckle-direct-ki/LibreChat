# Phase 2 Deploy-Runbook — Status-Chip-UI

**Status:** Code auf Branch `feature/file-handling-v2-phase-2-chip-ui`
(LibreChat-Fork). 3 Format-Patches off `973969e` (Phase 3 prod-HEAD)
liegen unter `deployment/patches/phase-2/`. Phase 2 ist komplett
**read-only** auf den Phase-3-Schemas (`metadata.pathStatus`,
`Conversation.session_files`) — keine DB-Migration, kein neuer Flag.

**Tests grün lokal:**
- Backend: 625 / 625 (`server/services/Files/` + `server/routes/files/` + `models/`)
- Frontend: 102 / 102 (`Files/` components + hooks)

**Diese Runbook deckt nur den Path A — Hand-Apply auf prod.**

---

## Vorbedingungen

- Phase 3 ist auf prod live mit `FILE_ROUTING_V2=true` (commit `973969e`
  oder neuer auf `~/LibreChat`).
- prod's `~/LibreChat`-Working-Tree hat ~20+ uncommitted customizations
  — siehe `git status -s` auf prod. Patches MÜSSEN per `git apply
  --3way` und ggf. Hand-Merge angewendet werden, nicht blind `git apply`.
- Rollback-Plan im Kopf: alle Phase-2-Änderungen sind additiv. Bei
  Problem `git stash --include-untracked` der Patch-Hunks und Rebuild —
  die Stage-1+3-Routen (statusBus, statusStream) werden bei Abwesenheit
  des Frontend-Codes ohnehin von keinem Client genutzt.

---

## Stage 1 — Patches auf prod transferieren

```bash
# WSL host:
cd /home/elsner/LibreChat-fork-phase-2
ls deployment/patches/phase-2/
# Apply-Reihenfolge ist die lexikografische — siehe "Format-Patches-Verzeichnis" unten.

# Dedizierter Temp-Dir auf prod, frisch geleert. Verhindert dass eine fremde
# /tmp/0*.patch-Datei aus einer früheren Iteration mit-applied wird (codex R2).
ssh slx-ki-webapp.gloeckle.local 'mkdir -p /tmp/phase-2-patches && rm -f /tmp/phase-2-patches/*.patch'
scp deployment/patches/phase-2/*.patch slx-ki-webapp.gloeckle.local:/tmp/phase-2-patches/
```

---

## Stage 2 — Hand-Apply auf prod

Der SSH-Block ist als Heredoc mit `set -euo pipefail` strukturiert: ein
gescheiterter `git apply --check` oder `git apply` bricht den ganzen Block
sofort ab (codex R1) — sonst würde ein verschluckter Konflikt im 3.
Patch in den 4. kaskadieren und am Ende blind den `git stash pop`
triggern. Bei Abbruch bleibt die Stash bewusst erhalten: das
`trap`-Handler-Echo zeigt wie sie nach Hand-Merge zurückgeholt wird.

```bash
ssh slx-ki-webapp.gloeckle.local <<'REMOTE'
set -euo pipefail
cd ~/LibreChat

# Bei jedem nicht-Null-Exit (apply check fail, apply fail, pop merge-konflikt)
# eine klare Recovery-Anleitung loggen statt stillschweigend zu enden.
trap 'rc=$?; if [ $rc -ne 0 ]; then
  echo "[ABORT] phase-2 deploy aborted (exit $rc)."
  echo "  stash bleibt erhalten: \"git stash list | grep phase-2-deploy-stash\""
  echo "  recovery: STASH_REF=\$(git stash list | grep phase-2-deploy-stash | head -1 | cut -d: -f1)"
  echo "           git stash pop \"\$STASH_REF\""
fi' EXIT

git status -s    # snapshot der bestehenden customizations
git stash --include-untracked --message "phase-2-deploy-stash"

# 3-way merge — fängt Konflikte ab statt blind zu überschreiben.
# Glob ist auf den dedizierten Temp-Dir aus Stage 1 gescoped (codex R2).
for p in /tmp/phase-2-patches/0*-*.patch; do
  echo "[apply] $p"
  git apply --3way --check "$p"
  git apply --3way        "$p"
done
echo "[OK] all patches applied"

# Nur erreicht wenn alle Patches sauber durch sind — set -e hat oben sonst
# abgebrochen. Stash-Pop kann immer noch auf prod-customizations konfligen;
# der trap-Handler oben gibt im Fall die Recovery-Schritte aus.
#
# `|| true` damit set -e nicht triggert wenn grep nichts findet (= keine
# Stash existierte, z.B. weil git status -s ohne uncommitted changes
# returnte und der vorige `git stash` ein no-op war). `grep -m1` statt
# `head -1` vermeidet einen SIGPIPE der unter pipefail ebenfalls den trap
# auslösen würde.
STASH_REF=$(git stash list | grep -m1 phase-2-deploy-stash | cut -d: -f1 || true)
if [ -n "$STASH_REF" ]; then
  echo "[stash-pop] $STASH_REF"
  git stash pop "$STASH_REF"
fi
REMOTE
```

**Wahrscheinliche Konfliktstellen** (Phase-3-deploy hat das genauso
gesehen):

1. `client/src/components/Chat/Input/Files/FileRow.tsx` —
   prod-customizations (theme, useChatFunctions) überlappen.
   - Konflikt erwartet, manuell merge'n: meine `useChatContext()`-
     Hook-Aufrufe + neue Imports zwischen die bestehenden Imports
     einfügen.
2. `client/src/components/Chat/Input/Files/FileContainer.tsx` —
   sollte sauber sein (nur der `pathStatus`-Prop wird hinzugefügt).
3. `client/src/style.css` — append-only am Dateiende, sauber.
4. `api/server/routes/files/index.js` — append-only, sauber.

> **Stash-Recovery on Konflikt:** Wenn das `git stash pop "$STASH_REF"`
> oben mit Merge-Konflikten failt, bricht der Heredoc ab und der
> trap-Handler druckt die Recovery-Anweisung. Working-Tree ist dann in
> "stash applied with conflicts"-Zustand: `git status` zeigt unmerged
> Files, normaler 3-way-merge per Editor, dann `git add` + `git
> stash drop` für die noch verbliebene Stash-Eintrag.

---

## Stage 3 — Build + Restart

```bash
cd ~/LibreChat
npm install --silent          # neue dep? Sollte keine sein, aber sicher.
npm run build:packages        # data-provider, data-schemas, api, client-pkg
npm run frontend              # Client-React-App neu bauen
pm2 restart librechat-api     # oder wie der prod-pm2-Name lautet
pm2 logs librechat-api --lines 50
```

**Erwartung in pm2-Logs:**
- Kein Boot-Error.
- Kein `Cannot find module` oder `Cannot read properties of undefined`.
- Erste Status-Stream-Verbindung wenn der erste User reloaded:
  `GET /api/files/status-stream` (oder kein Log, je nach Logger-Level).

---

## Stage 4 — Smoke-Test auf prod

1. **Browser-Refresh in incognito** (Service-Worker-Cache!).
2. Existierenden Chat öffnen → keine Crash, keine roten Console-Errors
   (S6 Pre-Phase-3-File-Rows-Stale-Risk).
3. Neue Chat öffnen, kleine PDF (z. B. ein 5-KB-Test-PDF) hochladen.
   Innerhalb 5 s Chip `Im Chat-Kontext geladen ✓ (X Zeichen)`.
4. F12 → Network-Tab → `/api/files/status-stream` ist offen, mind. 1
   `event: status` Event durchgekommen.
5. Theme-Toggle (Light → Dark) — Chip-Farben passen sich an.
6. **Falls UI nicht aktualisiert:** Hard-Refresh + Service-Worker-Unregister.

---

## Stage 5 — UAT

Vollständige UAT-Playbook `deployment/uat/2026-05-07-file-handling-v2-phase-2.md`
durchgehen. S1–S8 alle grün vor Sign-Off.

---

## Stage 6 — User-Comm

Nach UAT-Sign-Off: Mail aus
`deployment/user-comm/2026-05-07-file-status-chip-announcement.md` versenden.

---

## Rollback

Wenn Phase 2 produktiv Issues macht (z. B. SSE-Storm, Server-CPU-Spike,
Chip-Crash der die ganze File-Liste killt):

### Option A — Frontend-only-Rollback (empfohlen)

```bash
ssh slx-ki-webapp.gloeckle.local
cd ~/LibreChat
git checkout HEAD -- client/src/components/Chat/Input/Files/FileRow.tsx \
                     client/src/components/Chat/Input/Files/FileContainer.tsx \
                     client/src/components/Chat/Input/Files/FileStatusChip.tsx \
                     client/src/components/Chat/Input/Files/SessionFileChip.tsx \
                     client/src/hooks/Files/useFileStatusStream.ts \
                     client/src/hooks/Files/index.ts \
                     client/src/style.css
npm run frontend
# Backend SSE-Routen bleiben aktiv aber niemand verbindet sich mehr.
```

### Option B — Voll-Rollback (alle Patches)

```bash
ssh slx-ki-webapp.gloeckle.local <<'REMOTE'
set -euo pipefail
cd ~/LibreChat
for p in $(ls /tmp/phase-2-patches/0*-*.patch | sort -r); do
  echo "[reverse] $p"
  git apply --reverse "$p"
done
npm run build:packages
npm run frontend
pm2 restart librechat-api
REMOTE
```

Bei Konflikten: `git checkout HEAD -- <file>` der konfliktiven Files
und Custom-Customizations händisch wiederherstellen aus dem
phase-2-deploy-stash.

---

## Bekannte sharp-edges für Stage 2 (Phase 3 has Lessons)

- **Service-Worker-Cache** verzögert UI-Updates oft 1-2 Browser-Sessions
  bei normalem F5. Ctrl+Shift+R + Application → Service Workers →
  Unregister im DevTools fixt das.
- **EventSource-Reconnect** bei Connection-Drop: sse.js reconnectet
  automatisch, kann aber State verlieren. Akzeptabel — UI Reload
  bringt aktuellen Stand zurück (über metadata.pathStatus, das per
  conversation-load schon mit kommt).
- **Cross-User-Leaks bei SSE**: Backend filtert per `userId` *und*
  optional `conversationId`. UAT S8 muss das verifizieren.
- **Pre-Phase-3-File-Rows** (uploaded vor Phase-3-Deploy am 2026-05-06)
  haben kein `metadata.pathStatus`. UI rendert dann *keinen* Chip — das
  ist Absicht (S6).
- **session_files-Reload-Recovery**: Page-Reload löscht den
  SessionFileChip; nächster exec füllt ihn wieder. Phase-3-Backlog
  hatte den REST-Sync via conversation-load schon vorgesehen.
- **FILE_ROUTING_V2-Flag-OFF**: wenn Phase 3 wieder ausgeschaltet wird,
  schreiben die Pipelines kein `metadata.pathStatus` mehr — die UI ist
  dann genauso defensiv wie bei Pre-Phase-3 (S6-Verhalten ist die
  Auffanglinie).

---

## Phase Completion Checklist

- [ ] Stage 1-3 erfolgreich + pm2 logs clean
- [ ] Stage 4 Smoke-Test grün in incognito
- [ ] Stage 5 UAT S1-S8 alle grün, Dennis Sign-Off
- [ ] Stage 6 User-Comm versendet
- [ ] Memory-Update: Phase-2-final mit prod-HEAD-commit-sha

---

## Format-Patches-Verzeichnis

`deployment/patches/phase-2/` enthält die `git format-patch`-Outputs off
Phase-3-Baseline `973969e`, gruppiert nach Iteration:

- **Stage 1-3 (`0001-0003`):** Feature-Code (SSE-Bus + Route, Chips +
  Hook, Pipeline-Emit + CSS).
- **Stage 4 (`0004`):** Initiale Docs (UAT, Runbook, User-Comm). Ein
  kleiner Anteil dieses Patches modifiziert `deployment/`-Files, die
  später durch nachfolgende Patches überschrieben werden — das ist
  normal für format-patch-Sequenzen und harmlos.
- **Polish-iter-1 (`0005-0007+`):** Codex-Review-Findings F1–F6.

Apply in **lexicographic order** — sie sind nicht kommutativ (Stage 2
referenziert Stage-1-Imports; Stage 3 patcht Stage-2-Files). Glob
`/tmp/phase-2-patches/0*-*.patch` in einer For-Loop ist die idiomatische
Form (dedizierter Temp-Dir verhindert dass eine fremde Patch-Datei
aus `/tmp/` mit-applied wird — codex R2).

```bash
ls deployment/patches/phase-2/        # aktuelle Patch-Liste
```
