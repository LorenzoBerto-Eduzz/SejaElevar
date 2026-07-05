# Project Brief

This file is the durable identity card for the project. Keep it current when the project purpose, stack, commands, storage model, or priorities change.

## Identity

- Project name: `SejaElevar`
- Project kind: Local-first internal web platform / administrative tool
- Main project folder: `project/`
- Primary language/stack: Vite + React + TypeScript for the browser UI, plus a small self-contained Windows `SejaElevar.exe` launcher/provider for local file access.

## Purpose

SejaElevar is intended to help workers manage apprentices/students, companies, course modules, calendars, documents, document templates, and related administrative workflows from a browser-based interface.

The first product area is expected to be `Aprendizes`: a searchable and filterable list of students backed by local files, with progressively added tools for registration, editing, document tracking, and document generation.

The first versions should be practical rather than fancy. The core value is being able to view operational data, search/filter it, edit it when appropriate, fill extra values in the web UI, and generate documents from the selected data/templates.

## Audience Or Users

The app is for the internal team/workers who manage apprentices, student records, course information, document generation, and company-related records.

The application UI should be in Brazilian Portuguese (`pt-BR`), even when planning discussions happen in English.

## Current Scope

Current scope is first prototype development:

- Keep the actual app/project code inside `project/`.
- Start with local development and local file-based data.
- Keep the released app separate from the live data workspace.
- Preserve a path toward future hosting or sync, without overcommitting to a platform yet.
- Keep `Aprendizes` as the first mature data section for now, while building toward the broader linked model of Turmas, Aulas, Arcos, Empresas, Calendário, and Documentos.
- Use the current Vite/React prototype shell as the base: sidebar navigation, Elevar logo, multiple placeholder tabs, settings/search popups, an `.xlsx` import/table/edit flow for `Aprendizes`, and linked Turmas behavior.

## Run And Test Commands

```text
Run Vite dev server if needed: cd project && npm run dev:open
Build dev local app package: cd project && npm run build:single
Open/test dev package: project/dev/SejaElevar.exe
Package tested dev app as local release only when user asks: cd project && npm run export:release
Open local release: exports/SejaElevar/SejaElevar.exe
Test: no dedicated test suite yet; use npm run build:single as the normal dev verification check. Use npm run export:release only when the user asks for a release/export/package.
```

Do not treat `dist/` as source; it is a generated build output.

Dev and release are parallel app packages. Tracked `project/dev/` is the normal testing and cross-device package during development; ignored local output `exports/SejaElevar/` is the coworker-facing package prepared from the already-tested dev build without rebuilding it. They should keep the same app shape and approved behavior. Dev may expose explicitly dev-only live tuning controls; release hides/removes those controls, adds its README, and starts with clean runtime data folders.

## Important Constraints

- Local-first development is required at the beginning.
- The app should run as a browser-accessed local web app during early development. The current friendly local entry point is `SejaElevar.exe`, which starts the local provider and opens the browser UI. Opening the raw HTML/address without the provider should not show the app UI.
- Data starts as files/folders: real operational spreadsheets, structured data files, document templates, generated documents, company logos/images, and related assets.
- The first data workflow uses real `.xlsx` spreadsheets as active sources. The preferred direction is one unified workbook, `DadosElevar.xlsx`, with tabs such as `Aprendizes` and `Turmas`. Importing asks only for the source `.xlsx`; the local provider copies it directly into `dados/` as a timestamped active workbook such as `DadosElevar_hhmmssddmmyy.xlsx`. Whole-app recovery uses `dados/sistema/controle-global.json` plus up to three checkpoint workbook files under `dados/checkpoints/`. `dados/sistema/` also holds runtime controls and generated indexes such as `data-index.json`; the root of `dados/` should stay limited to the active workbook, `.gitkeep`, `checkpoints/`, `ementas/`, and `sistema/`. `dados/ementas/` stores imported official Ementa PDFs that derive Arcos and Disciplinas. `Recuperar Dados` restores a chosen whole-app checkpoint and makes the previous active workbook the newest checkpoint, so recovery is reversible and undo-aware.
- The preferred data shape is one active base workbook, `DadosElevar.xlsx`, with multiple worksheet tabs (`Aprendizes`, `Turmas`, `Arcos`, `Empresas`, `Aulas`, future `Cronograma`, future `Presencas`). The current separate workbook endpoints are transition compatibility. Importar/Exportar/Recuperar are global data controls for the whole workbook and should stay friendly for Google Drive/Google Sheets use.
- The `.xlsx` workbook remains the source of truth. The app also generates `dados/sistema/data-index.json` as disposable working memory for search, document generation, and cross-tool variables. Future tools should consume that generated index or a storage adapter, not scrape visible table cells.
- Imported/source workbooks can contain a hidden app-owned `ID SejaElevar (não editar)` column. This internal ID is not part of the user-facing table/search fields, but it should be used by the app for stable references and future relationships when available.
- Real student/person/company data may be sensitive. Do not commit real operational data unless the user explicitly decides that the repository/privacy setup makes that acceptable.
- Keep any sample/anonymized demo data separate from private local data. Demo data is optional and should not replace the real local workspace concept.
- Design the storage boundary so future adapters can target Google Drive synced folders, Google Sheets/Drive APIs, a hosted database, or another backend without rewriting every UI feature.
- The app should support choosing/importing a workspace. Missing required data should lead to a clear import/setup flow rather than a crash; for Aprendizes, missing a selected workbook means the table stays empty and asks for import, but the import state should not flash while an existing workbook is still being checked/loaded.
- Imported logos, templates, spreadsheets, and generated documents should be stored inside organized workspace folders.
- UI language should be Brazilian Portuguese.
- Keep features modular: student records, documents, calendars, company data, templates, and integrations should have clear boundaries.
- Future hosting should remain possible, but the first version does not need to be hosted.
- GitHub Pages/static hosting was considered. The current local path intentionally favors a browser UI plus a small local provider for local writes. Future providers may target Google Drive/Sheets or hosted storage.

## Current Priorities

1. Continue the first local browser app prototype using the Vite + React + TypeScript scaffold already in `project/`.
2. Keep the `Aprendizes` section useful for sorting, ordering, visualization, registration/editing, and direct inspection until Turmas can safely absorb some of those workflows.
3. Move toward the single-base-workbook direction while preserving the current local-first import/export/checkpoint behavior.
4. Keep Arcos/Disciplinas Ementa-driven: import official Ementa PDFs, parse them into workbook/index data, and show them as a read-only academic catalog before building Aula coverage.
5. Build the search and document-generation foundations on the generated data index while keeping source spreadsheets plain and recoverable.
6. Shape `Documentos` as the central document/template/generation area and `Calendário` as the global Cronograma visualization area.

Current roadmap clarification: the immediate work is continuous reliability testing of the active workbook chain from Ementa/Arcos/Disciplinas through Aprendizes, Turmas, Aulas coverage, Cronograma event blocks, Presencas, Horas Aplicadas, Plano de Ensino, Plano Progresso, undo/redo, export, and recovery. Visual/buttons/elements refinements should happen as focused adjustments whenever the user or coworkers/supervisors notice them during use, so keep UI code modular and tweakable. The current substantial implementation is `Calendário`, as the global/universal Cronograma visualization for all scheduled event blocks across Turmas, dates, and eventually events without a Turma; its first week-grid foundation exists and should next render/sync real Cronograma event blocks. Deep `Documentos` work is intentionally paused until the user aligns with the supervisor on official documents, templates/models, required data, and generation/storage expectations. `Empresas` should remain undefined until the document/contract needs clarify its real purpose.

Implementation status clarification: Aulas, Aulas-Disciplinas coverage, Cronograma event blocks inside Turmas, Presencas, Horas Aplicadas, Plano progress foundations, and the first `Calendário` week-view foundation now exist. The missing major areas are rendering real Cronograma events inside `Calendário`, full filters/search polish, document generation, and a defined Empresas workflow.

## Glossary

- `SejaElevar`: Project/platform name.
- `Aprendizes`: The first planned app section; a student/apprentice management list and tool area.
- `Database`: In early planning, this means the local file/folder data source used by the app, such as spreadsheets, JSON/CSV files, templates, images, and generated documents.
- `local_data/`: Candidate name for the live local workspace folder containing real operational files during development/testing. This folder should be ignored by Git by default.
- `asset_staging/`: File inbox/staging area, not the active app database unless explicitly promoted/imported.
- `workspace`: The chosen folder the app uses as its active data source. It may be local-only at first and later a Google Drive-synced folder.
- `Baked app`: A local distributable/use folder for testers/coworkers. Current entry point is `SejaElevar.exe`, which opens SejaElevar in the browser without requiring developer commands.
- `Project frame`: The outer repository structure that stores AI memory, docs, notes, staging assets, and Git/editor configuration.
- `project/`: The actual app/source folder inside the project frame.
- `memcheck`: Update durable memory docs only.
- `gitcheckpoint`: Update continuity docs if needed, commit current work, and push.

## Known Pitfalls

- This repo is initialized as Git on `main` and tracks `origin/main`.
- `project/` now has the first app scaffold, a local exe/provider package flow, Aprendizes XLSX import/table/write-back behavior, linked Turmas behavior, editable Aulas and coverage foundations, Ementa-driven read-only Arcos/Disciplinas import/display foundation, generated data-index foundations, global undo/recovery foundations, and the first Calendário week-view foundation, but no full filters, document generation, Calendar event rendering, or Empresas workflow yet.
- Do not treat `notes/todos.txt` as instructions unless the user explicitly asks.
- Do not commit dependency folders, build outputs, local secrets, or real private data.
- Future AI sessions should inspect `project/` before assuming the current UI state, commands, dependencies, or folder structure.
