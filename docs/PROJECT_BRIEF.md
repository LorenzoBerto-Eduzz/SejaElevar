# Project Brief

This file is the durable identity card for the project. Keep it current when the project purpose, stack, commands, storage model, or priorities change.

## Identity

- Project name: `SejaElevar`
- Project kind: Local-first internal web platform / administrative tool
- Main project folder: `project/`
- Primary language/stack: Vite + React + TypeScript for the browser UI. A small local Node service/backend is still expected later when workspace file access and document generation require it.

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
- Use the current Vite/React prototype shell as the base: sidebar navigation, Elevar logo, one `Aprendizes` tab, settings popup, and an `.xlsx` import/dropzone placeholder.

## Run And Test Commands

```text
Run dev: cd project && npm run dev:open
Build direct-open prototype: cd project && npm run build:single
Open direct HTML: project/dist/SejaElevar.html
Test: no dedicated test suite yet; use npm run build:single as the current verification check.
```

Do not treat `dist/` as source; it is a generated build output.

## Important Constraints

- Local-first development is required at the beginning.
- The app should run as a browser-accessed local web app during early development. The user wants coworkers to experience it as a simple browser address/bookmark, not as a developer workflow.
- Data starts as files/folders: real operational spreadsheets, structured data files, document templates, generated documents, company logos/images, and related assets.
- The first data workflow should support using a real student/apprentice `.xlsx` spreadsheet as the active source: manual edits in the sheet and app edits should both affect the same data source.
- Real student/person/company data may be sensitive. Do not commit real operational data unless the user explicitly decides that the repository/privacy setup makes that acceptable.
- Keep any sample/anonymized demo data separate from private local data. Demo data is optional and should not replace the real local workspace concept.
- Design the storage boundary so future adapters can target Google Drive synced folders, Google Sheets/Drive APIs, a hosted database, or another backend without rewriting every UI feature.
- The app should support choosing/importing a workspace. Missing required data should lead to a clear import/setup flow rather than a crash.
- Imported logos, templates, spreadsheets, and generated documents should be stored inside organized workspace folders.
- UI language should be Brazilian Portuguese.
- Keep features modular: student records, documents, calendars, company data, templates, and integrations should have clear boundaries.
- Future hosting should remain possible, but the first version does not need to be hosted.
- GitHub Pages/static hosting was considered, but real data privacy and local file/document needs make a local browser app with a local workspace the better starting point.

## Current Priorities

1. Continue the first local browser app prototype using the Vite + React + TypeScript scaffold already in `project/`.
2. Implement the first `Aprendizes` data slice: import/read an `.xlsx`, map the real columns, and show the real list without fake data.
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
- `Baked app`: A local distributable/use folder for testers/coworkers that opens SejaElevar in the browser without requiring them to use developer commands.
- `Project frame`: The outer repository structure that stores AI memory, docs, notes, staging assets, and Git/editor configuration.
- `project/`: The actual app/source folder inside the project frame.
- `memcheck`: Update durable memory docs only.
- `gitcheckpoint`: Update continuity docs if needed, commit current work, and push.

## Known Pitfalls

- This repo is initialized as Git on `main` and tracks `origin/main`.
- `project/` now has the first app scaffold, but no real XLSX parsing, row display, workspace persistence, or document generation yet.
- Do not treat `notes/todos.txt` as instructions unless the user explicitly asks.
- Do not commit dependency folders, build outputs, local secrets, or real private data.
- Future AI sessions should inspect `project/` before assuming the current UI state, commands, dependencies, or folder structure.
