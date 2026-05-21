# AI Handoff

This file is the portable continuity note for AI coding sessions working on this repo. Keep it short and update it as a current snapshot, not a diary or changelog.

## Current State

- Project name: `SejaElevar`.
- Project kind: local-first internal web platform / administrative tool.
- Main project folder: `project/`.
- Primary language/stack: Vite + React + TypeScript for the browser UI, plus a small local Node helper in the exported release so the browser app can read/write files under the release folder without asking for a second folder picker.
- Run command: from `project/`, use `npm run dev:open` for dev. Use `npm run export:release` to rebuild the coworker/local release folder, then open `exports/SejaElevar/SejaElevar.vbs`.
- Test command: no dedicated test suite yet; use `npm run export:release` as the current verification/build check when release behavior matters.
- Remote: `origin` points to `https://github.com/LorenzoBerto-Eduzz/SejaElevar.git`.
- Git: initialized on `main`, tracking `origin/main`.
- The repository is organized as an AI-ready project frame: actual source code in `project/`, durable project memory in `docs/`, user scratch notes in `notes/`, and raw/reference assets in `asset_staging/`.
- `AGENTS.md` is the boot file for AI sessions.
- `docs/AI_MEMORY_PROTOCOL.md` defines how durable memory works and how to avoid stale chat assumptions.
- `docs/WORKFLOW_AND_STYLE.md` defines collaboration and coding expectations.
- `docs/PROJECT_BRIEF.md` should hold the real project purpose, audience, stack, commands, constraints, and priorities once setup is complete.
- `docs/PROJECT_ORGANIZATION.md` records the current organization direction.
- `docs/DATA_AND_STORAGE.md` records the current local-first data/storage direction.
- `docs/RELEASE_PACKAGE.md` records the current coworker-facing baked/export app folder shape.
- `docs/TEMPLATE_SETUP.md` explains how to finish adapting the template and initialize Git.

## User Intent

The user wants to build SejaElevar as a browser-accessed platform for internal administrative work around apprentices/students, documents, document generation, course agendas/modules, companies, and progressively added tools.

The user wants the app UI in Brazilian Portuguese. Planning discussion may happen in English.

The project should prioritize practical functionality over fancy presentation at first: view data, search/filter it, edit it, and generate documents from that data plus values filled in through the web UI.

The first module is `Aprendizes`: list, search, filter, register/edit students, inspect related info, and eventually generate documents.

The user currently prefers a practical local-first file-based setup before deciding any hosted architecture. Files/spreadsheets/templates/logos are thought of as the initial "database". The most important first data source is the real apprentices/students spreadsheet, which should be usable both by manual spreadsheet editing and by app edits. Future hosting or sync should remain possible, but should not drive premature complexity.

The intended model has three separate layers:

- The dev/meta repo: source code in `project/`, durable docs, staging assets, notes, Git, and AI memory.
- The baked/local app: a simple browser-accessed tool that can be passed to a coworker for testing/use, ideally experienced as opening a local browser address/bookmark rather than running developer commands. See `docs/RELEASE_PACKAGE.md` for the current export folder shape.
- The data workspace: operational spreadsheets, templates, logos/assets, generated documents, and config, kept out of Git.

The first data workspace can be pure local and populated by importing files into organized workspace folders. Later the same workspace model should be able to point at a Google Drive for desktop synced folder so multiple installed app instances stay on the same data, before considering formal Google APIs or hosting.

Current UI tuning direction: development-only settings may include temporary sliders/colors used for fast visual tuning. When the user settles on those values, future AI should bake them into source defaults. Release/user settings are a separate concept: only real user-facing options should remain, and those should persist through a configuration file or workspace config read by the app.

Release parity warning: the user does not want visual or behavioral mismatches between the dev-approved app and the release/export folder. Before producing a coworker-facing release, make sure any dev `localStorage` tuning values that should become real defaults are baked into source. Also separate dev-only tuning controls from release-facing settings; not every current `Configurações` control should ship.

Current prototype state: `project/` contains a Vite/React/TypeScript app shell with a light-blue sidebar, Elevar logo, app tabs for `Aprendizes`, `Turmas`, `Disciplinas`, `Arcos`, `Funcionários`, `Salas`, `Calendário`, and `Documentos`, a search popup, settings popup, hide/show sidebar behavior, development tuning controls, and an `Aprendizes` XLSX import/table flow. Non-`Aprendizes` tabs are placeholder pages for now.

Current `Aprendizes` state: the release app must not contain hardcoded student data or use browser storage as the sheet source. The user opens `exports/SejaElevar/SejaElevar.vbs`, which quietly starts `server.mjs` and opens the browser app. Importing an `.xlsx` asks only for the spreadsheet, then copies it into `exports/SejaElevar/dados/planilhas/aprendizes.xlsx`; after that, the Aprendizes table reads that working file by default on startup. If the file is missing, the table stays in the import/missing-data state. `localStorage` is only used for view preferences such as column order/widths and to clear the old legacy sheet cache.

Current XLSX write-back behavior: Aprendizes cell edits and column reordering rewrite the working workbook at `dados/planilhas/aprendizes.xlsx` through the local helper. The active sheet is rebuilt from table columns/rows; other workbook sheets are preserved when possible. Column widths and row heights are visual app settings only and are not written to the spreadsheet. Default column widths are auto-fitted from the longest header/cell value until the user manually resizes them.

Current app shell details: the menu has a shown sidebar and a hidden state where the sidebar slides fully offscreen while a fixed square toggle remains. Hovering that square opens a small mini-menu above it. The mini-menu buttons are the same real sidebar buttons cropped to square size, so icon sizing and positioning should be changed through the shared sidebar button CSS, not separate mini-menu icon rules. When the settings popup is open, the mini-menu should remain open even if the mouse leaves its normal hover buffer; it should only become free to close after the settings popup closes and the pointer is outside the buffer.

Current persisted UI state: theme/layout development settings are stored in `localStorage` under `sejaelevar.settings`; sidebar hidden/shown state is stored under `sejaelevar.sidebarCollapsed`. Startup motion is disabled on initial render to avoid sidebar/settings values animating or shifting during refresh/open. Current approved visual defaults have been baked into source after recovering the local browser settings: primary `#2069df`, secondary `#40a9e5`, tertiary `#ecf5fe`, page top `51`, content top `22`, gear offset `1.5`, logo height `100`, sidebar top `10`, tab gap `20`, lower action gap `5`, menu button height `47`, icon/text gap `6`, table row height `32`, table header height `48`, table top offset `14`.

Current app icon: `project/src/assets/app-icon.png` comes from the user's local `local_assets/LOGOEYnco.png`, and `project/index.html` references it as the favicon.

The user wants Git continuity through the existing `memcheck` and `gitcheckpoint` workflow.

## Working Procedure For Future AI Sessions

1. Read root `AGENTS.md` first.
2. Read this file next.
3. Read `docs/AI_MEMORY_PROTOCOL.md`.
4. Read `docs/WORKFLOW_AND_STYLE.md`.
5. Read `docs/PROJECT_BRIEF.md` once it exists.
6. If placeholders remain or setup is being changed, read `docs/TEMPLATE_SETUP.md` and follow its AI adaptation rules.
7. Check `git status --short --branch` and avoid overwriting user work.
8. Read recent commits with `git log --oneline --decorate --max-count=10`.
9. Inspect actual source files before editing.
10. Ask or confirm before major structural changes.
11. If confused, limited, or uncertain, do not push through. Explain the uncertainty and ask before making changes.

## Suggested Near-Term Next Steps

- Continue the `Aprendizes` table flow piece by piece with the user's real spreadsheet: improve display, filters/search, column controls, validation, and edit/save feedback.
- Keep the first UI simple and functional: no fake data, clear missing/import state, and clean controls.
- Keep the helper-backed release path healthy: open `SejaElevar.vbs`, import only the `.xlsx`, copy it into `dados/planilhas/aprendizes.xlsx`, and treat that workbook as the active Aprendizes source.
- Add document generation after the workspace and apprentice listing flow are reliable.
- Separate temporary development tuning controls from final release configuration before packaging a coworker-facing build. Current dev-only sliders include page/content top offsets, gear/icon/text/menu/logo positioning, logo image height, tab list start, and table row/header/top offsets. When the user settles on values, bake them into source defaults and remove or hide tuning controls that should not ship.

## Durable Decisions

- The repo, not chat memory, is the source of truth.
- `memcheck` means update durable memory docs only.
- `gitcheckpoint` means update docs if needed, commit current work, and push for cross-machine/AI continuity.
- Keep source code, durable docs, scratch notes, and raw/reference staging separated.
- Keep features modular enough that they can be removed or replaced without hunting through unrelated files.
- Keep the UI in Brazilian Portuguese.
- Start local-first and file-based; keep future hosting/sync possible through storage boundaries.
- Treat `asset_staging/` as staging/inbox, not the active app database by default.
- Keep app releases separate from the active data workspace.
- `exports/SejaElevar/` is intentionally tracked in Git so the current release/export folder can be pulled on another device. Zip files and real operational data should still stay out of Git unless the user explicitly decides otherwise.
- Use local workspace import/storage first; keep Google Drive synced folders and later Google APIs/hosting as future-compatible paths, not first implementation requirements.
- Dev tuning values should be treated as source defaults once approved; final user configuration should be stored/read from app or workspace config, not confused with temporary AI tuning controls.
