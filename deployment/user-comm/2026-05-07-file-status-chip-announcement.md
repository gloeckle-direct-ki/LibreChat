# User-Communication — File-Status-Chips (Phase 2)

**Versand:** nach erfolgreichem Phase-2-Deploy + UAT-Sign-Off durch Dennis.
**Empfänger:** alle aktiven Glöckle-AI-User (interner Verteiler).
**Format:** kurze Mail oder Teams-Post.

---

## Vorgeschlagener Text (DE)

Hallo zusammen,

ab heute siehst du unter jeder hochgeladenen Datei einen kurzen
**Status-Chip** — er sagt dir auf einen Blick, ob die Datei

- ✓ als Kontext für den Chat geladen wurde,
- ✓ in der Wissensbasis indexiert wurde (mit Anzahl Chunks), oder
- ⚠ ob etwas beim Verarbeiten schiefgegangen ist (mit Grund).

**Neu zusätzlich:** Wenn der Code-Interpreter eine Datei *erstellt*
(z. B. eine CSV oder ein entpacktes ZIP), erscheint ein zweiter Chip
mit dem 📦-Symbol — diese Datei steht dann automatisch beim nächsten
Code-Run zur Verfügung.

### Was muss ich tun?

Nichts — die Anzeige läuft automatisch.

### Was tun bei einem roten ❌ oder gelben ⚠?

- **Rot ❌**: Datei konnte nicht hochgeladen werden — bitte einmal neu
  hochladen oder bei mir melden.
- **Gelb ⚠**: Datei ist im Chat verfügbar, konnte aber nicht in die
  Wissensbasis indexiert werden (z. B. verschlüsselte PDF). Der Chat
  funktioniert trotzdem — nur eine spätere Suche im Wissen findet die
  Datei dann nicht.

Beste Grüße,
Dennis

---

## Sharp-Edge-Reminder für Dennis

- Versand **erst nach** Phase-2-UAT-Sign-Off (S1-S7 grün in allen 3
  Themes) — Status-Chip-Pre-Phase-3 (S6) ist die häufigste Stolperfalle.
- Bei stillem Rollout: alte Chats zeigen *keine* Chips (Pre-Phase-3
  File-Rows haben kein `metadata.pathStatus`). Das ist **kein Bug** —
  die Chips erscheinen nur für Uploads ab Phase-2-Go-Live.
- Service-Worker-Cache: User soll bei "Chip nicht sichtbar" einmal
  Hard-Refresh machen (Ctrl+Shift+R) — siehe CLAUDE.md.
