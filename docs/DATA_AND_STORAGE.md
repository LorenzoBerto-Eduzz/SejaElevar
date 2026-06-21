# Data And Storage Direction

This note captures the current storage model for SejaElevar. Update it when the app changes file formats, adapters, sync, hosting, or privacy rules.

## Current Direction

SejaElevar is currently a local-first platform.

The app UI is a browser page, but local file access is handled by a small self-contained Windows launcher/provider, `SejaElevar.exe`. The user clicks the exe, the provider starts, and the browser UI opens. The browser app intentionally renders nothing if opened directly without the provider. This keeps the user experience friendly while allowing the app to read/write organized files under the app folder.

The most important early data source is the apprentices/students spreadsheet. The expected local format is `.xlsx`, matching the user's current Google Sheets/export workflow.

## Intended Unified Workbook Direction

The preferred data direction is now one active app workbook, not many independent workbook files. The user-facing/base file should be something like:

```text
DadosElevar.xlsx
```

When the local provider imports or saves this unified workbook, active runtime copies should use the timestamped pattern:

```text
DadosElevar_HHmmssddMMyy.xlsx
```

Inside that single workbook, each worksheet tab represents one app table/entity:

```text
Aprendizes
Turmas
Arcos
Empresas
Aulas
Cronograma
Presencas
```

This gives the worker a simple Google Drive/Google Sheets experience: open one spreadsheet, see clear worksheet tabs, manually inspect or adjust data when needed, then import/export one file in the app. It also keeps the app model clean because each worksheet remains a normal table: one row means one item of that type.

The current multi-workbook implementation should be treated as an intermediate local-first implementation, not the ideal final shape. Future refactors should move toward a storage adapter that reads/writes named worksheets inside one active workbook while preserving the app's separate generated entities.

Current migration anchor:

- `project/src/shared/data/baseWorkbook.ts` defines the intended base workbook file name, worksheet tabs, required columns, and which sheets are currently implemented through legacy separate workbook endpoints.
- `GET /api/base-workbook/schema` exposes the same provider-side intended shape for future import/export and diagnostics.
- `GET /api/base-workbook/file`, `POST /api/base-workbook/import`, `PUT /api/base-workbook/file`, `PUT /api/base-workbook/file/system`, and `POST /api/base-workbook/export` exist as the first provider bridge for the unified workbook. They store active files as `DadosElevar_hhmmssddmmyy.xlsx`.
- During the transition, the existing Aprendizes/Turmas import buttons detect a selected workbook that contains both `Aprendizes` and `Turmas` worksheet tabs and store it through the base workbook endpoint. Once an active `DadosElevar` workbook exists, it becomes the primary app data source for Aprendizes and Turmas, and global checkpoints should track that one active workbook rather than separate Aprendizes/Turmas files. Those pages prefer their named worksheet when reading a multi-sheet workbook, while still accepting old one-sheet files when no unified workbook is active.
- The app now treats `Aulas` and `Cronograma` as managed optional worksheets in the active unified workbook. Import/recovery/system normalization can create or extend those tabs without making them required for global workbook validation. `Aulas` is the reusable catalog/model layer with columns `ID`, `Aula`, `Cor`, `Instrutor Padrao`, `Sala Padrao`, and `Disciplinas`. `Cronograma` is the scheduled-instance layer with columns `ID`, `Turma`, `Data`, `Inicio`, `Fim`, `Tipo`, `Aula ID`, `Aula`, `Instrutor`, `Sala`, and `Cor`. Cronograma rows copy display/default values from an Aula model when one is used, so scheduled instances can stay historically stable or be overridden independently.
- The current storage mode is still `multi-workbook-transition`; do not remove the existing Aprendizes/Turmas endpoints until the UI has been migrated to read/write named worksheets from the unified workbook adapter.

Global app buttons should follow this direction:

- `Importar`: imports/replaces the whole active base workbook.
- `Exportar`: exports/copies the whole active base workbook.
- `Recuperar Dados`: restores whole-workbook checkpoints.
- Theme/color controls remain global.

These controls are global app controls, not page-local controls. Their enabled/disabled state and behavior should be identical on every tab because they act on the definitive `DadosElevar` workbook or app theme.

The global toolbar should avoid transient disabled states during valid data operations. Once the app has confirmed an active `DadosElevar` workbook, `Exportar` should remain enabled unless that workbook is truly removed or missing. `Recuperar Dados` should be enabled whenever there is a recoverable checkpoint workbook under `dados/checkpoints/`, and should not lock/unlock merely because the user switched tabs. During recovery swaps, undo/redo, or normal refreshes, `Recuperar Dados` should not flash disabled just because an intermediate refresh briefly sees stale provider state; successful recovery responses should include refreshed global recovery metadata, and the frontend should preserve or normalize the active toolbar state while the restored workbook/checkpoint metadata settles.

UI tabs do not need to match workbook worksheets 1:1. For example, the `Turmas` page can read both the `Turmas` and `Aprendizes` worksheets to show apprentices grouped by turma, and the `Arcos` page can manage the Disciplinas that live inside the Arcos/plano-de-ensino data.

The current sidebar still keeps `Aprendizes` as a main tab because it is useful for sorting, ordering, visualization, and direct apprentice management. A future Turmas-centered UI may absorb that work only after it can provide those same practical flows. `Documentos` should be a centralized document/template/generation tab rather than a data worksheet mirror. `Calendário` should visualize the global Cronograma. `Funcionários` and `Salas` are supporting/configurable linked values for Cronograma/Aula blocks for now, not main tabs.

The workbook design should avoid stacked sections inside one worksheet. Prefer multiple worksheet tabs inside one workbook over a single worksheet with Turmas rows at the top and Aprendizes rows below. Separate worksheet tabs are easier for the app to parse, easier for Google Sheets users to filter/sort, and less fragile when edited manually.

The planned relationship rule still holds: an Aprendiz is a separate record/entity, but it must reference valid required records such as Turma, Arco, and Empresa. That relationship rule does not require merging Aprendizes into the Turmas worksheet.

Current Aprendizes behavior:

- If no `.xlsx` exists directly in `dados/`, the Aprendizes page shows the missing/import state.
- Importing asks only for the source `.xlsx` file.
- The provider copies the selected file directly into `dados/` and immediately names it `Aprendizes_hhmmssddmmyy.xlsx` using system time.
- Import validates required Aprendizes column labels from `project/src/shared/data/schemas.ts`. Blank cells are valid and extra columns are preserved as custom variables, but missing required labels block import.
- During the transition, legacy controls such as `dados/controle.json` and `dados/turmas-controle.json` are tolerated only for migration/fallback and should not be recreated when empty. Once `DadosElevar` is active, `dados/sistema/dados-elevar-controle.json` is the primary workbook control. Recoverable app-state checkpoint metadata is tracked globally in `dados/sistema/controle-global.json`, and new unified checkpoints are direct timestamped workbook files under `dados/checkpoints/`, such as `DadosElevar_HHmmssddMMyy.xlsx`. Manually dropping extra `.xlsx` files into `dados/` should not change the active file unless no control metadata exists and the provider has to recover from existing files.
- When a saved edit changes data, the provider writes a fresh timestamped `Aprendizes_hhmmssddmmyy.xlsx` active file so the filename reflects the most recent update. The replaced active file is deleted unless it is the protected backup.
- Importing when no previous app data exists does not create a recoverable checkpoint. After a true first import, `Recuperar Dados` remains disabled because there is no previous real data state to recover to.
- Importing any workbook while app data already exists captures the previous whole-app data state as a global checkpoint and makes recovery immediately available for the state before import.
- The first edit after a fresh first import can capture the just-imported original workbook state as the first meaningful recovery checkpoint.
- The provider keeps up to three whole-app checkpoints under `dados/checkpoints/`, newest first. In the unified workbook path, each non-empty checkpoint is one direct `DadosElevar_HHmmssddMMyy.xlsx` file; old nested checkpoint folders are still tolerated for migration from the earlier multi-workbook fileset model. Repeated sequential imports in the same launched app session amend the same import checkpoint instead of filling the three checkpoint slots with near-duplicate states, and import metadata tracks whether the UI should describe the recovery as singular or plural. A new edit, recovery, or new launched session breaks that import sequence.
- The first edit after an import over existing data preserves the explicit before-import checkpoint. If the import sequence started from an empty state, the first edit captures the just-imported original workbook state as a normal before-edit checkpoint. Once the same app data chain has been edited in an earlier app session, the first edit in a later session can capture the whole-app state immediately before edits in the current session; later edits in that same session keep it.
- The root of `dados/` should contain only the current timestamped on-use workbook file, `.gitkeep`, and the intentional folders `checkpoints/` and `sistema/`. Old workbook files that are not active should be deleted by the provider after import/save/patch/recovery; historical recovery workbooks live under `dados/checkpoints/`, not as loose root `.xlsx` backups. App metadata/control JSON belongs under `dados/sistema/`.
- Aprendizes cell edits use value-based undo in the UI: a completed cell edit is one undo entry rather than one character at a time. Imports and recoveries are global undo actions. Each import stores the provider checkpoint id for the previous whole-app state, so `Ctrl+Z` can walk backward through imports, recoveries, edits, registrations, and deletions in chronological order.

Current Turmas behavior:

- Linked Turmas edits now use `Aprendizes.Turma` as the source of truth. Assigning an Aprendiz to a Turma updates the Aprendizes worksheet, rebuilds the generated Aprendizes/Turmas data-index entities, and notifies mounted pages. It should not write duplicated `Aprendizes` or `No. de Aprendizes` values back into the Turmas worksheet. Recovery is now global, so Turmas uses the same whole-app checkpoint as Aprendizes instead of an independent per-file recovery meaning.
- Turmas value writes go through `/api/turmas/values` and `project/launcher/WorkbookValuePatcher.cs`, an isolated provider helper that patches workbook XML values in place. This keeps `.xlsx` internals out of `Program.cs` and makes future workbook-storage changes easier to replace. The current patcher is best-effort for preserving workbook structure; exact Google Sheets visual styling round-trips are not guaranteed.
- Turmas is now an active linked-record flow, not just a placeholder table.
- Import validates required Turmas column labels from `project/src/shared/data/schemas.ts`: `Turma`, `Dia`, `Período`, `Instrutor`, and `Sala`. Blank cells are valid and extra columns are preserved. `Disciplina`, `No. de Aprendizes`, and `Aprendizes` are intentionally not required Turmas source columns.
- Legacy Turmas-only workbooks and controls are still tolerated during migration, but the active direction is a single `DadosElevar_HHmmssddMMyy.xlsx` workbook shared by Turmas and Aprendizes. Empty legacy Turmas controls should not remain in `dados/`.
- Turmas supports import, export, and provider-side value writes through Turmas-specific provider endpoints. Recovery UI uses the global `/api/recovery` endpoint and whole-app checkpoint metadata.
- The Turmas page displays imported Turmas as expandable groups. Each group can show the Aprendizes currently assigned to that Turma, using `Aprendizes.Turma` as the preferred relationship source.
- The Turmas group header is a compact linked-record summary. It displays and now edits the Turma name, `Dia`, `Período`, `Instrutor`, and `Sala`, while the Aprendizes count is derived from linked Aprendizes. Header field widths are calculated from the longest displayed value across all Turmas so separators/icons align row-to-row; the Turma name stays visible while the remaining header fields share the existing Turmas horizontal scrollbar. `Dia` uses fixed weekday options. `Período`, `Instrutor`, and `Sala` dropdowns merge values from the current Turmas worksheet with saved reusable options from the optional `Opções` worksheet in the same `DadosElevar` workbook. Creating a new period/instructor/room from the dropdown saves the Turma value through the normal data path and records the reusable option in `Opções`. Header dropdown text fields open with the current field value already loaded so the user can tweak it, and the dropdown height should extend only to the bottom of the content area before using its own internal scrollbar. The `+ Adicionar Aprendiz` row should keep its button/text fixed on the left while the student-list columns scroll horizontally.
- `Adicionar Turma` creates one unsaved draft Turma row at the top of the Turmas page. The draft row is not written to the workbook until all required Turmas fields are filled and the row `+` button is clicked; the draft `X` removes it immediately without confirmation. Saving the draft follows the normal Turmas data path: update the visible sheet state, write the active workbook, refresh generated indexes/linked views, and record a global undo/redo entry. Saved Turmas are displayed sorted by weekday, period start/end time, then name, while the draft stays above the sorted list. Deleting a saved Turma opens a confirmation modal, removes the Turmas row, clears `Aprendizes.Turma` for any linked Aprendizes, refreshes generated indexes/visible pages, and records the action for global undo/redo. The `Período` draft/dropdown input should only accept valid time-position digits, using the `HH:MMh - HH:MMh` shape.
- `+ Adicionar Aprendiz` opens a searchable picker of available Aprendizes and writes the selected Turma value back into the Aprendizes workbook, then refreshes the Aprendizes generated data index and notifies mounted pages through the shared `sejaelevar:aprendizes-data-changed` event.
- The Turmas student details popup can edit Aprendizes fields from inside the Turmas page. Its `Turma` field uses canonical dropdown matching against active Turmas names, and `Descadastrar Aprendiz` removes the selected Aprendiz row through the normal save/index path.
- The source workbook is not rewritten during Turmas import. In the app display and generated data index, apprentice membership is derived from linked Aprendizes when Aprendizes data exists. If an old Turmas sheet still contains legacy `No. de Aprendizes` or `Aprendizes` columns, they can be preserved as extra source columns but should not be treated as the relationship source of truth.
- Importing a workbook whose headers do not match the active tool schema shows a bottom-right red toast for 3 seconds: `Arquivo escolhido não possui os valores necessários`.

Expanded Turmas timetable visual/storage note:

- The expanded Turma body is a split work surface. The left side shows assigned Aprendizes and owns vertical scrolling when the list is longer than the available space. The right side is a filtered timetable preview for that Turma's `Dia` and `PerÃ­odo`; it should not have independent vertical scrolling.
- The timetable currently renders true 15-minute rows aligned to the Aprendizes row height, with a small visual tail after the period end. It intentionally does not render 5-minute rows. Aula/Cronograma blocks snap to thirds of a 15-minute row for 5-minute movement/resizing.

## Generated Data Index

The `.xlsx` files remain the source of truth. The app also maintains a generated internal index for search, document generation, and future cross-tool variable lookup.

For future academic/scheduling logic, read `docs/ACADEMIC_MODEL.md` before implementing. The agreed model separates reusable `Aulas`, global `Cronograma` planning blocks, Turma-filtered timetable views, attendance/historical completion records, Arcos/Modulos/Disciplinas, and generated progress/proof data. Completed attendance records should be treated as historical proof and should not silently change when planned Cronograma blocks or Aula definitions are edited later.

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
- `stableIds.ts`: manages the hidden app-owned record ID column used by generated records and future relationships.

For Aprendizes and Turmas, each row becomes one record with:

- `id`: read from the app-owned internal column `ID SejaElevar (não editar)` when present, with a temporary row-based fallback only when needed.
- `label`: `Nome` when available, otherwise the first nonblank value or `Registro n`.
- `fields`: every sheet column and current cell value.
- `customFields`: columns not in the known required schema.
- `searchText`: normalized searchable text built from entity, label, column names, and row values.
- `source`: source filename, sheet name, and row index.

The internal ID column is hidden from the table UI, item popup fields, search text, and public generated fields. It exists so future relationships, document generation, action-history references, and cross-sheet links can survive row reordering, blank names, imported names with typos, and manual spreadsheet edits. When a workbook is imported or loaded without IDs, or with duplicate IDs, the app repairs/generates them and writes the metadata back through a provider system-save endpoint. That system metadata write should not count as a user edit, checkpoint, recovery reason, or undoable action.

The Aprendizes index is rebuilt after active sheet load, import, recovery, save, cell edit, registration, deletion, and column reorder. If no active workbook exists or a provider read fails as missing, the Aprendizes entity is saved as an empty record set. The Turmas index is rebuilt after active sheet load, import, recovery, save, and apprentice assignment changes; when Aprendizes data exists, the Turmas index can derive apprentice membership from linked Aprendizes without writing duplicated source columns into the Turmas worksheet. The generated index should be treated as disposable working memory that can be rebuilt from source files, not as an independent database.

The local provider writes JSON files as readable UTF-8. PT-BR characters such as `ç`, `ã`, `é`, and `í` should appear normally in `dados/sistema/data-index.json`; if PowerShell displays mojibake, verify the file with a UTF-8-aware editor before assuming the stored data is corrupt.

Aprendizes, Turmas, Arcos, Disciplinas, and Aulas have separate generated-index entity definitions. `Disciplinas` is an internal/indexed concept managed through the Arcos flow for now, not a main sidebar tab. Future tabs such as Empresas and Documentos should add their own entities instead of mixing data into existing entities.

When implementing any new data-changing feature, define the whole data path before wiring the UI: which source workbook/file changes, how the generated data index refreshes, what action-history text appears, how undo/redo applies and refreshes linked data, and whether the action creates or uses a global recovery checkpoint. If any of those pieces are intentionally not affected, note why in the implementation or focused docs.

## Linked Records And Dropdown Fields

Future fields that assign one app item to another should be treated as linked/reference fields in the app, even when the source `.xlsx` stores simple human-readable text.

Examples:

- `Empresa` on an Aprendiz should eventually be a dropdown sourced from registered `Empresas`.
- `Turma` on an Aprendiz is now a dropdown sourced from registered `Turmas`.
- `Instrutor` and `Sala` on a Turma should eventually be dropdowns sourced from configured supporting values. `Disciplina` is no longer a direct Turma source field; discipline coverage belongs to the future Aulas/Arcos/Plano de Ensino flow.

The spreadsheet cells can continue storing the canonical display name, not hidden IDs, so exported files remain easy to read and paste back into Google Sheets. Internally, the app should match imported text by normalizing case, extra spacing, punctuation, and accentuation. For example, an imported value like `Sao Jose` should be able to match the registered option `São José`, after which the app displays/saves/exports the canonical registered spelling.

If an imported cell value does not match any registered dropdown option, the app should preserve the value but mark that cell/field as unresolved or unregistered until the user selects an existing option or registers a new one. The exact warning style can be decided later, but it should be visible enough that workers know the imported sheet contains a value the app cannot link.

This applies both to single-value dropdown fields and to future list fields. When a list field such as `Turmas.Aprendizes` is imported from manually edited sheet text, names should be split by comma + space, matched against registered Aprendizes with the same normalized comparison, canonicalized to the registered student name when matched, and flagged with a warning such as `Não é um aprendiz cadastrado` when unmatched. Repeated names in the same list should be ignored after the first occurrence.

The app should use the generated data index to make these links available to tools such as global search, document generation, and future pages that show related records.

Reusable support options that are useful across records but do not need their own main tab can live inside the same unified `DadosElevar` workbook in an optional worksheet named `Opções`. The current simple shape is two columns:

```text
Tipo | Valor
periodo | 08:00h - 12:00h
sala | Sala 1
instrutor | Fulano
```

The `Opções` worksheet is not required for import validation. If it exists, the app uses it as saved dropdown options. If it does not exist, the app can create it when the user creates a reusable option from the UI. Dropdowns should merge saved options from `Opções` with values already in use in source sheets, so active data never disappears from an option list merely because it is not saved as a reusable option. There is no small hard limit such as 30; hundreds of period, room, or instructor options are acceptable for this app scale. Deleting an option should remove only the saved reusable option, not any Turma/Aprendiz cell that currently uses that value.

## Planned Turmas Data Shape

The current planned Turmas values are:

- `Turma`: the turma name. This is the canonical option shown in the Aprendizes `Turma` dropdown.
- `Dia`: selected from day options.
- `Período`: selected from period options available for the chosen day.
- `Instrutor`: linked to registered Funcionários.
- `Sala`: linked to configured Sala options when that support is implemented; it is not currently a main tab.
`Disciplina`, `No. de Aprendizes`, and `Aprendizes` are not part of the current required Turmas source shape. Disciplina belongs to Aulas/Arcos/Plano de Ensino, and apprentice membership is derived from each Aprendiz's `Turma` value.

For app data consistency, the source of truth for "which apprentices are in a turma" is the `Turma` field on each Aprendiz. The Turmas page can display the list/count of Aprendizes under each Turma as an app-derived view, but the relationship should be maintained by assigning each Aprendiz to a Turma rather than manually duplicating a long name list inside the Turmas source sheet.

Day/period behavior direction: `Dia` is a dropdown of weekdays or defined day labels. `Período` is a dropdown filtered by the selected `Dia`. Period options do not currently need their own main app tab; they can be configured in a future settings/subtool area, with an affordance to add a new period from the dropdown flow.

## Global Recovery Checkpoints

`Recuperar Dados` is a whole-app checkpoint, not a per-tab backup. The provider stores current checkpoint metadata in `dados/sistema/controle-global.json`. In the unified workbook path, checkpoint content is a direct workbook file under `dados/checkpoints/`, named with the same `DadosElevar_HHmmssddMMyy.xlsx` pattern. A fresh first import from an empty workspace does not create a recoverable empty checkpoint; recovery stays disabled until a real previous data state exists.

A checkpoint currently contains the active `DadosElevar` workbook when it exists. Empty checkpoint metadata should be pruned when it does not represent a real recoverable state, and the recovery UI should stay disabled. Legacy nested folders containing separate Aprendizes/Turmas files remain readable during migration, but new global checkpoints should be direct unified workbook files.

Only real data changes should create or unlock a checkpoint. Selecting rows, focusing popup fields, opening dropdowns, blurring unchanged fields, or sending a value patch whose values already match the active workbook must be treated as no-op interaction. The provider should respond successfully to no-change patches without writing a new active workbook, creating a checkpoint, or enabling `Recuperar Dados`. Once a real checkpoint workbook exists, recovery availability is global and file-based: tab switches, hidden-tab refreshes, or page-local state should not disable it.

Any page that edits data owned by another worksheet/entity must flush its active draft to the active workbook before navigation, global undo/redo, global refresh, popup selection changes, or recovery/import reloads can overwrite local state. For example, editing an Aprendiz from inside the Turmas page still changes the Aprendizes worksheet, so that edit must go through the same queued save path as Aprendizes itself: commit the field value, write the active `DadosElevar` workbook, rebuild the generated index, broadcast global data changes, and refresh global toolbar/recovery state. React page state is only draft/display state; it must not be allowed to become a second source of truth.

Pressing `Recuperar Dados` restores the chosen checkpoint files into fresh timestamped active workbook files and stores the previous active app state as the new checkpoint, keeping recovery reversible. The recovery popup can list up to three checkpoints, newest first, with friendly labels in the format `HH:mm:ss dd/MM/yyyy`. Only the newest/top checkpoint should show the explanatory reason text; older entries should be grouped under `Outros backups:` and rely on their timestamps.

Recovery must update all app state immediately, not only after a tab switch. After a global recovery succeeds, the toolbar fetches the restored active base workbook and dispatches a forced `GLOBAL_DATA_CHANGED_EVENT` containing the recovered file and `force: true`. Mounted pages such as Aprendizes and Turmas must process that forced event even if they have a stale "suppress next global event" flag from a previous save, and they should reload their current visible elements from the restored workbook without first clearing to the import or blank state.

Current normal popup messages are:

- First imported app-data state after its first edit: `Recupere os dados para como estavam quando o arquivo foi importado.`
- Existing app data replaced by a new import: `Recupere os dados para como estavam antes da última importação.`
- Immediately after a recovery: `Recupere os dados para como estavam antes da última recuperação.`
- A later editing session has just captured the state before its current edits: `Recupere os dados para como estavam antes de edições nesta sessão.`
- That editing-session checkpoint is viewed after reopening without a newer edit: `Recupere os dados para como estavam antes da última sessão com edições.`
- No app data exists, or an initial import has not yet been edited: the toolbar button stays disabled.

Importing a workbook is also a global undo boundary. Each import entry stores the checkpoint id it must restore, so imports can be undone in order instead of only the newest import being recoverable. Sequential imports in the same app session are intentionally amended into one recoverable import action/checkpoint until an edit, recovery, or new session breaks the sequence, but each import still gets a visible action-history line.

Global undo is app-wide, not page-local, and is persisted in browser storage with a 200-action limit. `Ctrl+Z` walks backward through edits, registrations, deletions, imports, and recoveries; `Ctrl+Y` or `Ctrl+Shift+Z` walks forward again. If the next action to undo/redo was made from another tab, the app first switches to that tab, waits for the tab UI to settle, then runs that tab's handler. Undo handlers must update the source workbook(s), generated `dados/sistema/data-index.json`, visible UI state, selected item/popup state, and any linked workbook values affected by that action. Undo/redo should not open an item popup just because the affected row changed; if a popup is already open, preserve or adjust it only as needed for row insert/delete.

The dev app has a non-release action-history overlay in `project/src/shared/actionLog/`. It is toggled by a tiny top-left button, is visually click-through, lists newest actions at the top, colors done actions green, undone actions red, undone redo-path actions discarded by a new action yellow, and explanatory cut/reason lines blue. It is a diagnostic tool for understanding the global undo/checkpoint flow and should not become coworker-facing product UI unless explicitly redesigned.

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

- `dados/`: the active timestamped `DadosElevar` workbook plus the intentional `checkpoints/` and `sistema/` folders.
- `dados/sistema/`: generated app state and runtime controls derived from data files, currently `data-index.json`, `dados-elevar-controle.json`, and `controle-global.json` when real data exists.
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

When the user asks for `freshdev`, run:

```text
npm --prefix project run freshdev
```

This reset is for testing the dev app like a fresh first-use install. It clears active runtime data and generated traces under `project/dev/dados/`, including active `DadosElevar_*.xlsx` files, checkpoint files, workbook control JSON, and generated `data-index.json`, while keeping the required `dados/`, `dados/checkpoints/`, `dados/sistema/`, and `.gitkeep` structure. It also creates a one-shot marker consumed by the next dev app launch to clear browser-side data history: the global undo stack (`sejaelevar.globalUndo.v1`) and the dev action-history overlay (`sejaelevar.dev.actionHistory.v1`). Visual preferences such as dark/light mode, sidebar collapsed state, WebView zoom, and baked layout/color settings should remain unless the user explicitly asks for a full visual reset.

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
