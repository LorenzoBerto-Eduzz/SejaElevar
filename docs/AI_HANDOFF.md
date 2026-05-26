# AI Handoff

This file is the portable continuity note for AI coding sessions working on this repo. Keep it short and update it as a current snapshot, not a diary or changelog.

## Current State

- Project name: `SejaElevar`.
- Project kind: local-first internal web platform / administrative tool.
- Main project folder: `project/`.
- Primary language/stack: Vite + React + TypeScript for the browser UI, plus a small self-contained Windows `SejaElevar.exe` launcher/provider for local file access.
- Run/build command: from repo root, use `npm --prefix project run build:single` for the normal dev package. Then open `project/dev/SejaElevar.exe` to test. Use `npm --prefix project run export:release` only when the user explicitly asks for a release/export/package; it packages the already-tested dev build rather than rebuilding it.
- Test command: no dedicated test suite yet; use `npm --prefix project run build:single` as the current verification/build check during normal dev. Use API smoke tests against the local provider when file behavior changes.
- Remote: `origin` points to `https://github.com/LorenzoBerto-Eduzz/SejaElevar.git`.
- Git: initialized on `main`, tracking `origin/main`.
- The repository is organized as an AI-ready project frame: actual source code in `project/`, durable project memory in `docs/`, user scratch notes in `notes/`, and raw/reference assets in `asset_staging/`.
- `AGENTS.md` is the boot file for AI sessions.
- `docs/DATA_AND_STORAGE.md` records the current local-first data/storage direction.
- `docs/RELEASE_PACKAGE.md` records the current coworker-facing baked/export app folder shape.

## User Intent

The user wants to build SejaElevar as a browser-accessed platform for internal administrative work around apprentices/students, documents, document generation, course agendas/modules, companies, and progressively added tools.

The user wants the app UI in Brazilian Portuguese. Planning discussion may happen in English.

The project should prioritize practical functionality over fancy presentation at first: view data, search/filter it, edit it, and generate documents from that data plus values filled in through the web UI.

The first module is `Aprendizes`: list, search, filter, register/edit students, inspect related info, and eventually generate documents.

The intended model has three separate layers:

- The dev/meta repo: source code in `project/`, durable docs, staging assets, notes, Git, and AI memory.
- The baked/local app: a simple browser-accessed tool that can be passed to a coworker for testing/use. Current entry point is `SejaElevar.exe`, which starts the local provider and opens the browser UI.
- The data workspace: operational spreadsheets, templates, logos/assets, generated documents, and config, kept out of Git.

The first data workspace is pure local and populated by importing files into organized workspace folders. Later the same workspace model should be able to point at a Google Drive for desktop synced folder, Google Drive/Sheets APIs, or hosted storage.

## Current App

`project/` contains a Vite/React/TypeScript app shell with a light-blue sidebar, Elevar logo, app tabs for `Aprendizes`, `Turmas`, `Disciplinas`, `Arcos`, `Funcionários`, `Salas`, `Calendário`, and `Documentos`, a search popup, settings popup, hide/show sidebar behavior, development tuning controls, and an `Aprendizes` XLSX import/table flow. Non-`Aprendizes` tabs are placeholder pages for now.

`npm run build:single` builds the browser UI and publishes a dev package at:

```text
project/dev/
  SejaElevar.exe
  SejaElevar.html
  assets/
  dados/
  modelos/
  documentos_gerados/
```

The user should test with `project/dev/SejaElevar.exe`, not by opening `dist/` or raw generated files. The exe starts a local provider and opens the browser UI. The built dev package is intentionally tracked through Git/Git LFS for cross-PC handoff, while its live operational data inside `dados/`, `modelos/`, and `documentos_gerados/` remains ignored except `.gitkeep` placeholders. `exports/` is local generated output and is ignored by Git; recreate it from dev whenever the user requests a handoff package. The browser app intentionally renders nothing if opened directly without the exe/provider; do not add "open through the app" warning text to the UI.

Dev/release package rule: `project/dev/` and `exports/SejaElevar/` should have the same app shape and behave like the same app. The user tests the real flow in tracked `project/dev/` during normal development. Local-only `exports/SejaElevar/` is generated only when the user explicitly asks for release/export/package, by copying the already-tested dev executable/assets and applying release-only packaging changes. Dev may include explicitly dev-only live tuning controls; release hides/removes those, adds `README.md`, and starts with clean runtime data folders. Before generating release, bake the approved dev state into source and refresh/test dev so release does not differ unexpectedly.

Current provider lifecycle: the browser page sends heartbeats and a close signal. Closing the page/tab requests immediate provider shutdown; if the close signal is missed, the heartbeat timeout is the fallback. The provider should not be treated as a permanent background service. Current heartbeat interval is 1 second from the browser, and the provider fallback timeout defaults to 5 seconds.

Current `Aprendizes` behavior:

- If no `.xlsx` exists directly in `dados/`, the table stays in the import/missing-data state.
- Importing asks only for the source `.xlsx`.
- The provider copies the selected file directly into `dados/` and immediately names it `Aprendizes_hhmmssddmmyy.xlsx` using system time.
- `dados/controle.json` tracks the active workbook, one protected backup, its reason, and editing-session history for the current working data chain. Importing or recovering starts a new chain. The app does not treat manually dropped `.xlsx` files as active unless it must recover metadata from existing files.
- Aprendizes cell edits and column reordering write back to the active workbook. Real data changes save as a fresh timestamped on-use workbook, keeping one tracked backup workbook when available.
- If the first import has no previous active workbook, the imported workbook is recorded as its protected original; recovery is disabled until the first edit creates a distinct active state. Importing a new file over an active workbook protects the previous active state and enables recovery immediately.
- The first editing session after an import or recovery preserves its explicit backup. Once the same working chain was edited in an earlier app session, the first edit in a later session replaces the backup with the state before the current session's edits. After reopening without a newer edit, it is described as the state before the last session with edits.
- `Recuperar Dados` opens a centered modal over a blurred/dimmed page. Confirming swaps the active and protected workbooks; recovery remains immediately available afterward to reverse the latest recovery.
- Current normal recovery descriptions identify: original imported state, state before the last import, state before the last recovery, state before edits in the current session, or state before the last session with edits.
- Cell undo is value-based: one completed cell edit is one undo entry, with a current stack limit of 1000.
- There is intentionally no export button right now, per user request.
- Column widths and row heights are visual app settings only and are not written to the spreadsheet.
- The Aprendizes page stays mounted while switching tabs and gates the import state until the provider/workbook check finishes, so returning to Aprendizes should not briefly flash the import button before showing an already-loaded table.

Current persisted UI state: theme/layout development settings are stored in `localStorage` under `sejaelevar.settings`; sidebar hidden/shown state is stored under `sejaelevar.sidebarCollapsed`. Startup motion is disabled on initial render to avoid sidebar/settings values animating or shifting during refresh/open. Current approved visual defaults have been baked into source after recovering the local browser settings: primary `#2069df`, secondary `#40a9e5`, tertiary `#ecf5fe`, page top `51`, content top `22`, gear offset `1.5`, logo height `100`, sidebar top `10`, tab gap `20`, lower action gap `5`, menu button height `47`, icon/text gap `6`, table row height `32`, table header height `48`, table top offset `14`.

Current app icon: `project/src/assets/app-icon.png` is intentionally an exact copy of the user's local `local_assets/LOGOEYnco.png`; `project/index.html` references it as the favicon, and the launcher build embeds it as the exe icon.

## Working Procedure For Future AI Sessions

1. Read root `AGENTS.md` first.
2. Read this file next.
3. Read `docs/AI_MEMORY_PROTOCOL.md`.
4. Read `docs/WORKFLOW_AND_STYLE.md`.
5. Read `docs/PROJECT_BRIEF.md`.
6. Check `git status --short --branch` and avoid overwriting user work.
7. Read recent commits with `git log --oneline --decorate --max-count=10`.
8. Inspect actual source files before editing.
9. Ask or confirm before major structural changes.

## Suggested Near-Term Next Steps

- Continue the `Aprendizes` table flow piece by piece with the user's real spreadsheet: improve display, filters/search, column controls, validation, and edit/save feedback.
- Keep the first UI simple and functional: no fake data, clear missing/import state, and clean controls.
- Continue testing in dev first through `project/dev/SejaElevar.exe`.
- Do not rebuild or hand over `exports/SejaElevar/` unless the user explicitly asks for release/export/package.
- Keep `exports/` untracked and local-only; cross-device continuity uses the tracked dev package plus the exporter script.
- Add document generation after the workspace and apprentice listing flow are reliable.
- Separate temporary development tuning controls from final release configuration before packaging a coworker-facing build.

## Durable Decisions

- The repo, not chat memory, is the source of truth.
- `memcheck` means update durable memory docs only.
- `gitcheckpoint` means update docs if needed, commit current work, and push for cross-machine/AI continuity.
- Keep source code, durable docs, scratch notes, and raw/reference staging separated.
- Keep the UI in Brazilian Portuguese.
- Start local-first and file-based; keep future hosting/sync possible through storage boundaries.
- Treat `asset_staging/` as staging/inbox, not the active app database by default.
- Keep app releases separate from the active data workspace.
- Use local workspace import/storage first; keep Google Drive synced folders and later Google APIs/hosting as future-compatible paths, not first implementation requirements.
- Dev tuning values should be treated as source defaults once approved; final user configuration should be stored/read from app or workspace config, not confused with temporary AI tuning controls.
