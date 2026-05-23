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
- Build the first MVP around the `Aprendizes` section before implementing the broader platform.
- Use the current Vite/React prototype shell as the base: sidebar navigation, Elevar logo, multiple placeholder tabs, settings/search popups, and an `.xlsx` import/table/edit flow for `Aprendizes`.

## Run And Test Commands

```text
Run Vite dev server if needed: cd project && npm run dev:open
Build dev local app package: cd project && npm run build:single
Open/test dev package: project/dev/SejaElevar.exe
Build local release only when user asks: cd project && npm run export:release
Open local release: exports/SejaElevar/SejaElevar.exe
Test: no dedicated test suite yet; use npm run build:single as the normal dev verification check. Use npm run export:release only when the user asks for a release/export/package.
```

Do not treat `dist/` as source; it is a generated build output.

Dev and release are parallel app packages. `project/dev/` is the normal testing package during development; `exports/SejaElevar/` is the generated coworker-facing package. They should keep the same folder/file structure and approved behavior. Dev may expose explicitly dev-only live tuning controls; release should hide/remove those controls and keep only the end-user app/settings.

## Important Constraints

- Local-first development is required at the beginning.
- The app should run as a browser-accessed local web app during early development. The current friendly local entry point is `SejaElevar.exe`, which starts the local provider and opens the browser UI. Opening the raw HTML/address without the provider should not show the app UI.
- Data starts as files/folders: real operational spreadsheets, structured data files, document templates, generated documents, company logos/images, and related assets.
- The first data workflow uses a real student/apprentice `.xlsx` spreadsheet as the active source. Importing asks only for the source `.xlsx`; the local provider copies it directly into `dados/` as `Aprendizes_hhmmssddmmyy.xlsx`. The provider tracks the current on-use workbook and one backup workbook in `dados/controle.json`. Real saved edits write a fresh timestamped on-use workbook so the filename reflects the latest update. `Recuperar Dados` restores by copying the tracked backup into a fresh on-use workbook while keeping the backup intact.
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
2. Continue the first `Aprendizes` data slice: import/read an `.xlsx`, copy it under `dados/`, map the real columns, show the real list without fake data, and write supported edits back to the working file.
3. Establish a workspace model where the app can import/use local spreadsheets, templates, logos/assets, generated documents, and config without committing private data.
4. Decide whether the first `Aprendizes` slice is read-only before editing support.
5. Add document generation after the workspace and apprentice listing flow are reliable.

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
- `project/` now has the first app scaffold, a local exe/provider package flow, and Aprendizes XLSX import/table/write-back behavior, but no filters, validation, document generation, or broader workspace manager yet.
- Do not treat `notes/todos.txt` as instructions unless the user explicitly asks.
- Do not commit dependency folders, build outputs, local secrets, or real private data.
- Future AI sessions should inspect `project/` before assuming the current UI state, commands, dependencies, or folder structure.
