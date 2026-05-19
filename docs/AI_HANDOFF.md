# AI Handoff

This file is the portable continuity note for AI coding sessions working on this repo. Keep it short and update it as a current snapshot, not a diary or changelog.

## Current State

- Project name: `SejaElevar`.
- Project kind: local-first internal web platform / administrative tool.
- Main project folder: `project/`.
- Primary language/stack: Vite + React + TypeScript for the browser UI. A small local Node service/backend is still expected later when workspace file access and document generation need it.
- Run command: from `project/`, use `npm run dev:open` for dev or `npm run build:single` then open `dist/SejaElevar.html` for the direct-open prototype.
- Test command: no dedicated test suite yet; use `npm run build:single` as the current verification/build check.
- Remote: `origin` points to `https://github.com/LorenzoBerto-Eduzz/SejaElevar.git`.
- Git: initialized on `main`, tracking `origin/main`.
- The repository is organized as an AI-ready project frame: actual source code in `project/`, durable project memory in `docs/`, user scratch notes in `notes/`, and raw/reference assets in `asset_staging/`.
- `AGENTS.md` is the boot file for AI sessions.
- `docs/AI_MEMORY_PROTOCOL.md` defines how durable memory works and how to avoid stale chat assumptions.
- `docs/WORKFLOW_AND_STYLE.md` defines collaboration and coding expectations.
- `docs/PROJECT_BRIEF.md` should hold the real project purpose, audience, stack, commands, constraints, and priorities once setup is complete.
- `docs/PROJECT_ORGANIZATION.md` records the current organization direction.
- `docs/DATA_AND_STORAGE.md` records the current local-first data/storage direction.
- `docs/TEMPLATE_SETUP.md` explains how to finish adapting the template and initialize Git.

## User Intent

The user wants to build SejaElevar as a browser-accessed platform for internal administrative work around apprentices/students, documents, document generation, course agendas/modules, companies, and progressively added tools.

The user wants the app UI in Brazilian Portuguese. Planning discussion may happen in English.

The project should prioritize practical functionality over fancy presentation at first: view data, search/filter it, edit it, and generate documents from that data plus values filled in through the web UI.

The first module is `Aprendizes`: list, search, filter, register/edit students, inspect related info, and eventually generate documents.

The user currently prefers a practical local-first file-based setup before deciding any hosted architecture. Files/spreadsheets/templates/logos are thought of as the initial "database". The most important first data source is the real apprentices/students spreadsheet, which should be usable both by manual spreadsheet editing and by app edits. Future hosting or sync should remain possible, but should not drive premature complexity.

The intended model has three separate layers:

- The dev/meta repo: source code in `project/`, durable docs, staging assets, notes, Git, and AI memory.
- The baked/local app: a simple browser-accessed tool that can be passed to a coworker for testing/use, ideally experienced as opening a local browser address/bookmark rather than running developer commands.
- The data workspace: operational spreadsheets, templates, logos/assets, generated documents, and config, kept out of Git.

The first data workspace can be pure local and populated by importing files into organized workspace folders. Later the same workspace model should be able to point at a Google Drive for desktop synced folder so multiple installed app instances stay on the same data, before considering formal Google APIs or hosting.

Current UI tuning direction: development-only settings may include temporary sliders/colors used for fast visual tuning. When the user settles on those values, future AI should bake them into source defaults. Release/user settings are a separate concept: only real user-facing options should remain, and those should persist through a configuration file or workspace config read by the app.

Current prototype state: `project/` now contains a Vite/React/TypeScript app shell with a light-blue sidebar, Elevar logo, one `Aprendizes` tab, settings popup, hide/show sidebar behavior, development tuning controls, and an `Importar .xlsx` dropzone/button placeholder. The XLSX file is accepted and named in the UI, but rows are not parsed or displayed yet.

Current app shell details: the menu has a shown sidebar and a hidden state where the sidebar slides fully offscreen while a fixed square toggle remains. Hovering that square opens a small mini-menu above it. The mini-menu buttons are the same real sidebar buttons cropped to square size, so icon sizing and positioning should be changed through the shared sidebar button CSS, not separate mini-menu icon rules. When the settings popup is open, the mini-menu should remain open even if the mouse leaves its normal hover buffer; it should only become free to close after the settings popup closes and the pointer is outside the buffer.

Current persisted UI state: theme/layout development settings are stored in `localStorage` under `sejaelevar.settings`; sidebar hidden/shown state is stored under `sejaelevar.sidebarCollapsed`. Startup motion is disabled on initial render to avoid sidebar/settings values animating or shifting during refresh/open.

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

- Continue the `Aprendizes` XLSX flow once the user brings the real spreadsheet structure: parse rows, map columns, and display the real list.
- Keep the first UI simple and functional: no fake data, clear missing/import state, and clean controls.
- First product slice: `Aprendizes` list over a local XLSX spreadsheet, using anonymized/demo rows only if committed examples become useful.
- Decide the exact `Aprendizes` spreadsheet columns and whether the first displayed slice is read-only before editing support.
- Add document generation after the workspace and apprentice listing flow are reliable.
- Separate temporary development tuning controls from final release configuration before packaging a coworker-facing build. Current dev-only sliders include page/content top offsets, gear/icon/text/menu/logo positioning, logo image height, and tab list start. When the user settles on values, bake them into source defaults and remove or hide tuning controls that should not ship.

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
- Use local workspace import/storage first; keep Google Drive synced folders and later Google APIs/hosting as future-compatible paths, not first implementation requirements.
- Dev tuning values should be treated as source defaults once approved; final user configuration should be stored/read from app or workspace config, not confused with temporary AI tuning controls.
