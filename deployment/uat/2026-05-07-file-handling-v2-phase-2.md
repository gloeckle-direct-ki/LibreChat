# Phase 2 UAT — Status-Chip UI

**Branch:** `feature/file-handling-v2-phase-2-chip-ui`
**Baseline:** Phase 3 (`973969e`) auf prod, FILE_ROUTING_V2=true.
**Datum geplant:** 2026-05-07 (Dennis vor Ort).

## Setup

- [ ] Patches aus `deployment/patches/phase-2/` auf prod hand-applied
      (siehe `phase-2-deploy-runbook.md` Stage 1-4).
- [ ] Service-Worker-Cache geleert: User-Browser hat den neuen Build
      geladen — bei Verdacht: incognito-Window + Hard-Refresh
      (Ctrl+Shift+R) + DevTools → Application → Service Workers →
      Unregister.
- [ ] Test-User vorhanden, eingeloggt.
- [ ] 3 Themes greifbar (Settings → Theme): **Light**, **Dark**, ggf. Neon.
- [ ] Test-Files bereit:
  - `test-small.pdf` (≤ 20 KB, durchsuchbarer Text)
  - `test-large.pdf` (≥ 50 KB, durchsuchbarer Text)
  - `test-encrypted.pdf` (verschlüsselt — bricht inline+rag)
  - `test.zip` (10 KB — Code-Interpreter-Eingabe)
  - bestehender `(RAG)`-Chat aus Phase-1.5-Migration (Pre-Phase-3-File-Rows)

## Szenarien

Pro Szenario: in mindestens 2 Themes (Light + Dark) testen, in Neon falls verfügbar.

### S1 — Happy Path: kleine PDF (inline)

1. Neuen Chat öffnen → `test-small.pdf` per Drag-Drop oder Paperclip hochladen.
2. **Erwartung:** innerhalb ~3 s erscheint unter dem File ein Chip:
   - Text: `Im Chat-Kontext geladen ✓ (X Zeichen)`
   - Farbe: grün (chip-success).
3. Tooltip leer (kein Failure).
4. Erste Frage zum Inhalt schicken — Antwort soll auf den File-Inhalt eingehen.
5. **Status-Bar in F12 / Network:** SSE-Stream `/api/files/status-stream`
   ist offen, mind. ein `event: status` mit `state:loaded` enthalten.

### S2 — Happy Path: große PDF (RAG)

1. Neuen Chat → `test-large.pdf` hochladen.
2. **Erwartung:** Chip wandert von:
   - `wird verarbeitet …` (chip-pending, gestrichelt) →
   - `Wissensbasis: indexiert wird …` (chip-pending) →
   - `Wissensbasis indexiert ✓ (N Chunks)` (chip-success).
3. Live-Update via SSE; mehrere `event: status` im Network-Tab sichtbar.

### S3 — ZIP (mount-only)

1. Neuen Chat → `test.zip` hochladen.
2. **Erwartung:** kein chip ODER chip mit `wird verarbeitet …` (mount=ready
   wird nicht explizit geschrieben — Option B aus Plan).
3. Im Code-Interpreter: `import zipfile; zipfile.ZipFile('/mnt/data/test.zip').extractall('/mnt/data/extracted')`.
4. Folge-Frage zur extrahierten Struktur — Code-Interpreter sieht
   `/mnt/data/extracted/`.

### S4 — Verschlüsselte PDF (inline+rag failure)

1. Neuen Chat → `test-encrypted.pdf` hochladen.
2. **Erwartung:** Chip zeigt:
   - Variante a: `❌ Datei nicht verarbeitbar` (chip-error) — wenn
     mount auch failed,
   - Variante b: `⚠ Inline-Extraktion fehlgeschlagen: <Reason> · ⚠
     Indexierung fehlgeschlagen: <Reason>` (chip-warn) — wenn mount ok.
3. Tooltip enthält den konkreten Reason (verschlüsselt / encrypted).
4. **Telemetrie-Check:** in MongoDB:
   `db.filepathfailures.find().sort({createdAt:-1}).limit(2)` → 2 Einträge
   für inline + rag mit Reason.

### S5 — Forced rag-api-failure

1. SSH auf prod: `pm2 stop rag-api`.
2. Neuen Chat → `test-large.pdf` hochladen.
3. **Erwartung:** Chip zeigt
   `⚠ Indexierung fehlgeschlagen: rag-api unreachable` (chip-warn).
4. Inline-Pfad bleibt erfolgreich (Chip enthält auch
   `Im Chat-Kontext geladen ✓`).
5. **Recovery:** `pm2 start rag-api`. Neuer Upload → Chip wieder grün.

### S6 — Pre-Phase-3-File-Rows (Stale-Risk-Hoch)

1. Bestehenden `(RAG)`-Chat aus Phase-1.5-Migration öffnen — File-Row hat
   **kein** `metadata.pathStatus` in der DB.
2. **Erwartung:** kein Crash, keine Console-Errors. Verhalten:
   - Chip wird **gar nicht** angezeigt (FileContainer rendert keinen Chip
     wenn `pathStatus === undefined`), ODER
   - Chip zeigt `wird verarbeitet …` (chip-pending) — aber das ist
     verwirrend.
3. **Aktuelle Implementierung:** Chip wird *nicht* angezeigt für Pre-Phase-3-
   Files (FileContainer.tsx Z. 30-32: `mergedPathStatus !== undefined`).
   Das ist die definitive UX-Entscheidung — keine Verwirrung durch
   "wird verarbeitet" für Files die schon längst fertig sind.
4. **Manuell testen:** F12 → keine `Cannot read property 'state' of undefined`
   o. ä. im Console.

### S7 — Code-generierte Datei (`session_files`)

1. Code-Interpreter-fähigen Agent öffnen (z. B. einen mit `execute_code`-Tool).
2. Prompt: *"Erstelle eine kurze CSV-Datei `out.csv` mit drei Spalten und
   speichere sie unter `/mnt/data/`."*
3. Folge-Prompt: *"Lies die Datei `/mnt/data/out.csv` ein und zeige mir
   die ersten 2 Zeilen."*
4. **Erwartung:** unterhalb der Upload-Zeile erscheint ein zweiter Chip:
   - Symbol: 📦
   - Text: `out.csv · vom Code generiert` (chip-success).
5. Tooltip enthält die `session_id`.
6. **Reload-Test:** Browser-Reload des Chats. Chip verschwindet (P2-Trade-
   off — initial-state via REST ist Phase-3-Backlog) — beim nächsten exec
   erscheint er wieder.

## Service-Worker-Check (CLAUDE.md-Gotcha)

- Erst-Test in **incognito-Window**.
- Bei Verdacht auf Stale-CSS: Hard-Refresh (Ctrl+Shift+R) + DevTools →
  Application → Service Workers → Unregister.
- Wenn Chip-Farben in Dark-Theme falsch aussehen: Theme einmal
  umschalten (Light → Dark zurück).

## Cross-User-Sicherheit

### S8 — User-Scope der SSE-Events

1. User A in Tab 1 öffnen, leerer Chat.
2. User B (anderer Account) in Tab 2 (Incognito) öffnen, eine PDF hochladen.
3. **Erwartung:** in Tab 1 von User A erscheint **kein** Chip-Update für
   die User-B-Datei. Backend filtert per `event.userId === req.user.id`.

## Acceptance-Kriterien

- [ ] S1 grün in 2+ Themes
- [ ] S2 grün in 2+ Themes; Live-Updates beobachtet (mind. 2 Status-Events)
- [ ] S3 keine UI-Crashs
- [ ] S4 chip-error oder chip-warn mit korrektem Reason in Tooltip
- [ ] S4 `filepathfailures` befüllt
- [ ] S5 Recovery sauber
- [ ] S6 keine Console-Errors auf bestehenden Pre-Phase-3-Chats
- [ ] S7 SessionFileChip erscheint live nach exec-Output
- [ ] S8 keine Cross-User-Leaks beobachtet
- [ ] Dennis Sign-Off ✍️
