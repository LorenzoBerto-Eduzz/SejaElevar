# Data And Storage Direction

This note captures the current storage model for SejaElevar. Update it when the app changes file formats, adapters, sync, hosting, or privacy rules.

## Current Direction

SejaElevar is currently a local-first platform.

The app UI is a browser page, but local file access is handled by a small self-contained Windows launcher/provider, `SejaElevar.exe`. The user clicks the exe, the provider starts, and the browser UI opens. The browser app intentionally renders nothing if opened directly without the provider. This keeps the user experience friendly while allowing the app to read/write organized files under the app folder.

The most important early data source is the apprentices/students spreadsheet. The expected local format is `.xlsx`, matching the user's current Google Sheets/export workflow.

Current Aprendizes behavior:

- If no `.xlsx` exists directly in `dados/`, the Aprendizes page shows the missing/import state.
- Importing asks only for the source `.xlsx` file.
- The provider copies the selected file directly into `dados/` and immediately names it `Aprendizes_hhmmssddmmyy.xlsx` using system time.
- Import validates required Aprendizes column labels from `project/src/shared/data/schemas.ts`. Blank cells are valid and extra columns are preserved as custom variables, but missing required labels block import.
- The app then uses `dados/controle.json` to track the active workbook, one protected backup, its reason, and whether the current working data chain was edited in an earlier app session. Importing or recovering starts a new working data chain. Manually dropping extra `.xlsx` files into `dados/` should not change the active file unless no control metadata exists and the provider has to recover from existing files.
- When a saved edit changes data, the provider writes a fresh timestamped `Aprendizes_hhmmssddmmyy.xlsx` active file so the filename reflects the most recent update. The replaced active file is deleted unless it is the protected backup.
- Importing when no previous active workbook exists records the imported workbook as both active and protected original. Recovery stays disabled until an edit makes the active state differ from that original.
- Importing a new workbook while another workbook is active makes the prior active file the protected backup, deletes the older tracked backup if needed, and makes the imported workbook active. Recovery is immediately available for the state before import.
- The first editing session after an import or recovery preserves its explicit backup. Once the same working chain has been edited in an earlier app session, the first edit in a later session replaces the backup with the state immediately before edits in the current session; later edits in that same session keep it.
- `dados/` should normally contain the current on-use workbook, one backup workbook when available, `controle.json`, and `.gitkeep`.
- Aprendizes cell edits use value-based undo in the UI: a completed cell edit is one undo entry rather than one character at a time. The current undo stack limit is 1000 cell edits.

## Generated Data Index

The `.xlsx` files remain the source of truth. The app also maintains a generated internal index for search, document generation, and future cross-tool variable lookup.

Current generated index location:

```text
dados/sistema/data-index.json
```

Current provider endpoints:

- `GET /api/data-index`: returns the whole generated index.
- `PUT /api/data-index/entities/{entityId}`: replaces/merges one generated entity in the index.

Current frontend helpers live in `project/src/shared/data/`:

- `schemas.ts`: known required column labels and label normalization.
- `dataIndex.ts`: converts sheet rows into normalized records.

For Aprendizes, each row becomes one record with:

- `id`: generated as `aprendizes:rowNumber`.
- `label`: `Nome` when available, otherwise the first nonblank value or `Registro n`.
- `fields`: every sheet column and current cell value.
- `customFields`: columns not in the known required schema.
- `searchText`: normalized searchable text built from entity, label, column names, and row values.
- `source`: source filename, sheet name, and row index.

The Aprendizes index is rebuilt after active sheet load, import, recovery, save, cell edit, and column reorder. If no active workbook exists or a provider read fails as missing, the Aprendizes entity is saved as an empty record set. The generated index should be treated as disposable working memory that can be rebuilt from source files, not as an independent database.

Only Aprendizes is currently indexed. Future tabs such as Empresas, Turmas, Disciplinas, and Documentos should add their own entities instead of mixing data into the Aprendizes entity.

`Recuperar Dados` uses one reversible backup slot. Pressing it swaps the tracked active and backup workbooks instead of copying or deleting either one. The state active immediately before recovery therefore becomes the recovery target for reversing that action. Recovery stays enabled after a recovery while the two tracked workbooks differ.

Current normal popup messages are:

- First imported workbook after its first edit: `Recupere os dados originais da planilha importada.`
- Existing active workbook replaced by a new import: `Recupere os dados anteriores à última importação.`
- Immediately after a recovery swap: `Recupere os dados para como estavam antes da última recuperação.`
- A later editing session has just captured the state before its current edits: `Recupere os dados para como estavam antes de edições nesta sessão.`
- That editing-session checkpoint is viewed after reopening without a newer edit: `Recupere os dados para como estavam antes da última sessão com edições.`
- No workbook exists, or an initial import has not yet been edited: the toolbar button stays disabled.

Older local development metadata may retain a legacy recovery message until a new import or recovery enters the current flow.

The first app should focus on useful operations rather than fancy presentation: view data, filter/search data, edit it when appropriate, fill extra values through the web UI, and generate documents from selected data and templates.

## Workspace Model

The actual live data should not be confused with `asset_staging/`. `asset_staging/` is an inbox/staging area for raw files, references, transfers, or test imports. The app's active data lives in the runtime package folders.

Think of the project as three separate layers:

- The dev/meta repo: source code, docs, AI memory, notes, staging assets, Git, and project setup.
- The baked/local app: the usable SejaElevar folder/app that a coworker opens through `SejaElevar.exe`, which opens the browser UI.
- The data workspace: operational spreadsheets, templates, logos/assets, generated documents, and config, kept out of Git.

The current dev package shape is:

```text
project/dev/
  SejaElevar.exe
  SejaElevar.html
  assets/
  dados/
  modelos/
  documentos_gerados/
```

A release/export package should use the same structure under `exports/SejaElevar/` when the user explicitly asks for a release.

Suggested meaning:

- `dados/`: spreadsheets and future structured data used/edited by app tools, starting with Aprendizes.
- `dados/sistema/`: generated app state derived from data files, currently `data-index.json`.
- `modelos/`: source document templates.
- `documentos_gerados/`: output files generated by the app.
- `assets/`: app-owned/meta assets and future local app state/config files.

For safety, real operational data should be ignored by Git by default. The dev package shell and runnable dev app may be tracked for cross-PC handoff, but live `.xlsx`, template, and generated-document contents stay out of Git unless the user explicitly chooses otherwise after considering privacy. `exports/` is a local generated handoff folder, ignored by Git and regenerated from the tested dev package on demand. If committed test data is useful, use clearly anonymized demo fixtures separate from live data.

## Storage Boundary

The app should not spread file-reading and file-writing logic directly through UI components.

Use a storage/data adapter boundary so UI features call clear operations such as:

- list apprentices
- get apprentice details
- save apprentice
- list companies
- list course modules
- generate document from template

The current adapter is the local provider started by `SejaElevar.exe`. Later adapters could target Google Drive for desktop synced folders, Google Sheets/Drive APIs, a hosted database, or another service.

## Configuration Model

Treat development tuning controls and release/user configuration as different systems.

During development, the app may expose temporary controls such as alignment sliders, spacing sliders, color pickers, or icon offsets so the user and AI can quickly tune the interface. Those values are not automatically part of the final product. When the user approves a tuning result, future AI should bake the chosen values into source defaults and remove or hide dev-only controls before a release build.

The release app should expose only user-facing configuration that makes sense for workers or the institution, such as:

- company/institution name
- logo
- app colors/theme
- active workspace/data behavior
- document/template-related options

Release configuration should be persisted and read back by the app on startup. Current simple UI settings use browser storage; future file-backed config can live under `assets/` or another deliberate config location once the product needs it.

## Local App Shape

The app should still feel like a simple local webpage: one browser page with tabs/tools for `Aprendizes`, companies, agendas, documents, and settings.

The provider should not behave like a permanent background service. The browser page sends heartbeats and a close signal. Closing the page/tab requests provider shutdown immediately. If the close signal is missed, heartbeat timeout is the fallback. Current browser heartbeat cadence is 1 second, and the provider fallback idle timeout defaults to 5 seconds.

During normal development, do not rebuild/give `exports/SejaElevar/` unless the user explicitly asks for a release/export/package. Test runtime behavior in `project/dev/` through:

```text
project/dev/SejaElevar.exe
```

## Future Sync Direction

The current idea for future multi-worker use is that the app can point at a shared/synced workspace, possibly a Google Drive folder.

Possible staged path:

1. Local-only app folder during development.
2. Workspace folder located inside Google Drive for desktop, letting Drive sync file changes across machines/users.
3. If needed, a formal Google Drive/Sheets integration that reads/writes through Google APIs instead of relying only on the synced desktop folder.
4. If the app grows beyond file sync, move to a hosted backend/database while keeping the same storage adapter boundary.

For now, do not start with Google APIs unless the user explicitly redirects. The simpler starting path is local files/imports plus a storage boundary.

## Privacy Rule

Assume real student/company documents may be sensitive.

Do not commit real operational data to Git unless the user explicitly chooses that setup after considering privacy, repository visibility, and cross-PC sync needs.

Use sample/anonymized data for code examples, tests, demos, and commits.

## Open Decisions

- Exact package/release flow after the current `SejaElevar.exe` dev package.
- Exact first internal data shape beyond `.xlsx` import/edit.
- Exact `Aprendizes` spreadsheet columns, mappings, validations, and filters.
- Whether future shared data should use Google Drive for desktop synced folders, Google Drive/Sheets APIs, or a hosted backend.
- Whether generated documents live inside the app folder, an ignored local folder, or a user-selected external folder.
- Future hosting target, if any.
