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
- The app then uses `dados/controle.json` to track the active Aprendizes workbook. Recoverable app-state checkpoints are tracked globally in `dados/controle-global.json` plus `dados/checkpoints/<checkpoint-id>/`. Manually dropping extra `.xlsx` files into `dados/` should not change the active file unless no control metadata exists and the provider has to recover from existing files.
- When a saved edit changes data, the provider writes a fresh timestamped `Aprendizes_hhmmssddmmyy.xlsx` active file so the filename reflects the most recent update. The replaced active file is deleted unless it is the protected backup.
- Importing when no previous app data exists records the imported state as a disabled original checkpoint. Recovery stays disabled until an edit makes the active state differ from that original.
- Importing any workbook while app data already exists captures the previous whole-app data state as a global checkpoint and makes recovery immediately available for the state before import.
- The provider keeps up to three whole-app checkpoint filesets under `dados/checkpoints/`, newest first. Repeated sequential imports in the same launched app session amend the same import checkpoint instead of filling the three checkpoint slots with near-duplicate states. A new edit, recovery, or new launched session breaks that import sequence.
- The first editing session after an import or recovery preserves its explicit checkpoint. Once the same app data chain has been edited in an earlier app session, the first edit in a later session can capture the whole-app state immediately before edits in the current session; later edits in that same session keep it.
- `dados/` should normally contain current timestamped on-use workbooks, per-workbook control files, `controle-global.json`, `checkpoints/`, `sistema/`, and `.gitkeep`.
- Aprendizes cell edits use value-based undo in the UI: a completed cell edit is one undo entry rather than one character at a time. Imports and recoveries are global undo actions. Each import stores the provider checkpoint id for the previous whole-app state, so `Ctrl+Z` can walk backward through imports, recoveries, edits, registrations, and deletions in chronological order.

Current Turmas behavior:

- Linked Turmas edits now touch both sides of the relationship. Assigning an Aprendiz to a Turma updates the Aprendizes active workbook, syncs derived `Aprendizes` and `No. de Aprendizes` values into the active Turmas workbook, rebuilds the generated Aprendizes/Turmas data-index entities, and notifies mounted pages. Recovery is now global, so Turmas uses the same whole-app checkpoint as Aprendizes instead of an independent per-file recovery meaning.
- Turmas value writes go through `/api/turmas/values` and `project/launcher/WorkbookValuePatcher.cs`, an isolated provider helper that patches workbook XML values in place. This keeps `.xlsx` internals out of `Program.cs` and makes future workbook-storage changes easier to replace. The current patcher is best-effort for preserving workbook structure; exact Google Sheets visual styling round-trips are not guaranteed.
- Turmas is now an active linked-record flow, not just a placeholder table.
- Import validates required Turmas column labels from `project/src/shared/data/schemas.ts`: `Turma`, `Dia`, `Período`, `Instrutor`, `Sala`, `Disciplina`, `No. de Aprendizes`, and `Aprendizes`. Blank cells are valid and extra columns are preserved.
- The provider copies the selected workbook directly into `dados/` as `Turmas_hhmmssddmmyy.xlsx` and tracks the active Turmas workbook in `dados/turmas-controle.json`. Older local `dados/turmas.json` metadata can be migrated into the current control file shape.
- Turmas supports import, export, and provider-side value writes through Turmas-specific provider endpoints. Recovery UI uses the global `/api/recovery` endpoint and whole-app checkpoint metadata.
- The Turmas page displays imported Turmas as expandable groups. Each group can show the Aprendizes currently assigned to that Turma, using `Aprendizes.Turma` as the preferred relationship source.
- `+ Adicionar Aprendiz` opens a searchable picker of available Aprendizes and writes the selected Turma value back into the Aprendizes workbook, then refreshes the Aprendizes generated data index and notifies mounted pages through the shared `sejaelevar:aprendizes-data-changed` event.
- The Turmas student details popup can edit Aprendizes fields from inside the Turmas page. Its `Turma` field uses canonical dropdown matching against active Turmas names, and `Descadastrar Aprendiz` removes the selected Aprendiz row through the normal save/index path.
- The source workbook is not rewritten during Turmas import. If `No. de Aprendizes` is a Google Sheets formula, the formula remains in the copied `.xlsx`.
- In the app display and generated data index, `No. de Aprendizes` and `Aprendizes` are derived from linked Aprendizes when Aprendizes data exists. If Aprendizes data is unavailable, `No. de Aprendizes` falls back to counting comma-separated names from the Turmas `Aprendizes` cell.
- Importing a workbook whose headers do not match the active tool schema shows a bottom-right red toast for 3 seconds: `Arquivo escolhido não possui os valores necessários`.

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

For Aprendizes and Turmas, each row becomes one record with:

- `id`: generated as `aprendizes:rowNumber`.
- `label`: `Nome` when available, otherwise the first nonblank value or `Registro n`.
- `fields`: every sheet column and current cell value.
- `customFields`: columns not in the known required schema.
- `searchText`: normalized searchable text built from entity, label, column names, and row values.
- `source`: source filename, sheet name, and row index.

The Aprendizes index is rebuilt after active sheet load, import, recovery, save, cell edit, registration, deletion, and column reorder. If no active workbook exists or a provider read fails as missing, the Aprendizes entity is saved as an empty record set. The Turmas index is rebuilt after active sheet load, import, recovery, save, and apprentice assignment changes; when Aprendizes data exists, the Turmas index uses linked Aprendizes to derive `No. de Aprendizes` and `Aprendizes`. The generated index should be treated as disposable working memory that can be rebuilt from source files, not as an independent database.

The local provider writes JSON files as readable UTF-8. PT-BR characters such as `ç`, `ã`, `é`, and `í` should appear normally in `dados/sistema/data-index.json`; if PowerShell displays mojibake, verify the file with a UTF-8-aware editor before assuming the stored data is corrupt.

Aprendizes and Turmas are currently indexed as separate entities. Future tabs such as Empresas, Disciplinas, and Documentos should add their own entities instead of mixing data into existing entities.

## Linked Records And Dropdown Fields

Future fields that assign one app item to another should be treated as linked/reference fields in the app, even when the source `.xlsx` stores simple human-readable text.

Examples:

- `Empresa` on an Aprendiz should eventually be a dropdown sourced from registered `Empresas`.
- `Turma` on an Aprendiz is now a dropdown sourced from registered `Turmas`.
- `Instrutor`, `Sala`, and `Disciplina` on a Turma should eventually be dropdowns sourced from registered `Funcionários`, `Salas`, and `Disciplinas`.

The spreadsheet cells can continue storing the canonical display name, not hidden IDs, so exported files remain easy to read and paste back into Google Sheets. Internally, the app should match imported text by normalizing case, extra spacing, punctuation, and accentuation. For example, an imported value like `Sao Jose` should be able to match the registered option `São José`, after which the app displays/saves/exports the canonical registered spelling.

If an imported cell value does not match any registered dropdown option, the app should preserve the value but mark that cell/field as unresolved or unregistered until the user selects an existing option or registers a new one. The exact warning style can be decided later, but it should be visible enough that workers know the imported sheet contains a value the app cannot link.

This applies both to single-value dropdown fields and to future list fields. When a list field such as `Turmas.Aprendizes` is imported from manually edited sheet text, names should be split by comma + space, matched against registered Aprendizes with the same normalized comparison, canonicalized to the registered student name when matched, and flagged with a warning such as `Não é um aprendiz cadastrado` when unmatched. Repeated names in the same list should be ignored after the first occurrence.

The app should use the generated data index to make these links available to tools such as global search, document generation, and future pages that show related records.

## Planned Turmas Data Shape

The current planned Turmas values are:

- `Turma`: the turma name. This is the canonical option shown in the Aprendizes `Turma` dropdown.
- `Dia`: selected from day options.
- `Período`: selected from period options available for the chosen day.
- `Instrutor`: linked to registered Funcionários.
- `Sala`: linked to registered Salas.
- `Disciplina`: linked to registered Disciplinas.
- `No. de Aprendizes`: preferably derived by the app from linked Aprendizes, not manually typed.
- `Aprendizes`: preferably derived/listed by the app from Aprendizes assigned to the Turma, exported as names separated by comma + space.

For app data consistency, the recommended source of truth for "which apprentices are in a turma" is the `Turma` field on each Aprendiz. The Turmas page can display or export the list/count of Aprendizes under each Turma, but the relationship should normally be maintained by assigning each Aprendiz to a Turma rather than manually duplicating a long name list inside the Turmas source sheet. If an imported Turmas sheet already contains an `Aprendizes` list, the app can use it for display/validation during import, but it should treat conflicts with `Aprendizes.Turma` carefully instead of silently making both sides inconsistent.

Day/period behavior direction: `Dia` is a dropdown of weekdays or defined day labels. `Período` is a dropdown filtered by the selected `Dia`. Period options do not currently need their own main app tab; they can be configured in a future settings/subtool area, with an affordance to add a new period from the dropdown flow.

## Global Recovery Checkpoints

`Recuperar Dados` is a whole-app checkpoint, not a per-tab or per-file backup. The provider stores current checkpoint metadata in `dados/controle-global.json` and checkpoint workbooks under `dados/checkpoints/<checkpoint-id>/`.

A checkpoint currently contains copies of the active Aprendizes and Turmas workbooks when those workbooks exist. Future data tabs should join this checkpoint through the provider workbook-source list instead of creating independent recovery meanings.

Pressing `Recuperar Dados` restores the chosen checkpoint files into fresh timestamped active workbook files and stores the previous active app state as the new checkpoint, keeping recovery reversible. The recovery popup can list up to three checkpoints, newest first, with friendly labels in the format `HH:mm:ss dd/MM/yyyy`.

Current normal popup messages are:

- First imported app-data state after its first edit: `Recupere os dados para como estavam quando foram importados pela primeira vez.`
- Existing app data replaced by a new import: `Recupere os dados para como estavam antes da última importação.`
- Immediately after a recovery: `Recupere os dados para como estavam antes da última recuperação.`
- A later editing session has just captured the state before its current edits: `Recupere os dados para como estavam antes de edições nesta sessão.`
- That editing-session checkpoint is viewed after reopening without a newer edit: `Recupere os dados para como estavam antes da última sessão com edições.`
- No app data exists, or an initial import has not yet been edited: the toolbar button stays disabled.

Importing a workbook is also a global undo boundary. Each import entry stores the checkpoint id it must restore, so imports can be undone in order instead of only the newest import being recoverable. Sequential imports in the same app session are intentionally amended into one import action/checkpoint until an edit, recovery, or new session breaks the sequence.

Global undo is app-wide, not page-local, and is persisted in browser storage with a 200-action limit. `Ctrl+Z` walks backward through edits, registrations, deletions, imports, and recoveries; `Ctrl+Y` or `Ctrl+Shift+Z` walks forward again. If the next action to undo/redo was made from another tab, the app first switches to that tab, waits for the tab UI to settle, then runs that tab's handler. Undo handlers must update the source workbook(s), generated `dados/sistema/data-index.json`, visible UI state, selected item/popup state, and any linked workbook values affected by that action.

The dev app has a non-release action-history overlay in `project/src/shared/actionLog/`. It is toggled by a tiny top-left button, is visually click-through, lists newest actions at the top, colors done actions green, undone actions red, and history cuts/session markers blue. It is a diagnostic tool for understanding the global undo/checkpoint flow and should not become coworker-facing product UI unless explicitly redesigned.

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

During development, the app may expose temporary controls such as alignment sliders, spacing sliders, color pickers, or icon offsets so the user and AI can quickly tune the interface. Those values are not automatically part of the final product. When the user approves a tuning result, future AI should bake the chosen values into source defaults and remove or hide dev-only controls before a release build. Current visual sliders are hidden after baking the latest popup/table/menu values; do not reintroduce them unless the user explicitly asks for another tuning pass.

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
