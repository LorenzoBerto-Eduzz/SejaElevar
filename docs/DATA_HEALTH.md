# Data Health / Guarding Model

This note captures the agreed direction for the SejaElevar data health guard.

## Purpose

Data Health is not a decorative debug button. It is the app's reliability and integrity layer for the active `DadosElevar` data state.

The user expects SejaElevar to be business/industry reliable: workers may inspect or manually alter the workbook outside the app, then bring it back into the app. The app must read the active workbook, detect what is structurally wrong, inconsistent, suspicious, incomplete, or unsafe, and show clear issues with severity so the team can fix data before it breaks workflows or documents.

The workbook remains the operational source of truth. Internal data/indexes adapt to it. Data Health must inspect the active on-use workbook and the relationships that the app derives from it.

## Severity Model

Use these severities consistently:

- `error`: critical or blocking. The data can break app logic, corrupt generated academic/document records, lose privacy/legal evidence, or make source relationships invalid.
- `warning`: needs review. The app can often keep working, but the state is incomplete, suspicious, or may affect future workflows/documents.
- `info`: useful operational note. Not wrong by itself, but something the worker may want to complete.

Examples:

- Aprendiz without `Arco de Aprendizagem`: `warning`, because the academic plan/progress cannot be generated or tracked yet.
- Aprendiz pointing to a missing Arco: `error`.
- Duplicate stable IDs or ID collision across entities: `error`.
- Presenca marked `Presente` without matching Horas Aplicadas when it should count: `error`.
- Historical Presenca linked to an Aula/Turma/Disciplina that was later deleted: `warning`, because frozen snapshot labels remain proof and should not be rewritten automatically.
- Presenca/Horas rows pointing to an Aprendiz ID that no longer exists because of manual workbook editing/import inconsistency: `error`.
- Aula without Disciplina coverage: `warning`.
- Aprendiz without Turma: usually `info` unless a future workflow makes it mandatory.

## Current Implementation

Core files:

- `project/src/shared/data/dataHealth.ts`: reads the active workbook and builds user-facing Data Health issues.
- `project/src/shared/data/dependencyInspector.ts`: structural dependency/ID authority shared by import validation and Data Health.
- `project/src/shared/data/workbookImportIntegrity.ts`: blocks unsafe imports, including manual Aprendiz removal and reintroduction of purged identities.
- `project/src/shared/ui/DataHealthButton.tsx`: current diagnostic UI access point in the sidebar/bottom global controls, with a dedicated popup positioned like Configuracoes/Search.

Current Data Health checks include:

- required managed worksheet/header read failures;
- duplicate catalog values for Arcos, Turmas, Aulas, and Disciplinas;
- blank required record values such as Aprendiz name, Turma name, Arco name, Aula name, Disciplina/module/arco/workload;
- invalid Disciplina workload and invalid Horas Aplicadas minutes;
- invalid Presenca status values outside `Presente` / `Ausente`;
- Aprendizes missing or pointing to missing Arcos/Turmas;
- Aprendizes with Arco but without Plano de Ensino rows;
- Aulas without Disciplina coverage;
- broken or blank Aula-to-Disciplina coverage links;
- Cronograma events without Aula/Turma, with missing Aula/Turma, or with incomplete Data/Inicio/Fim;
- Presencas marked `Presente` without expected Horas Aplicadas;
- Horas Aplicadas pointing to no active Presenca;
- Plano de Ensino rows missing matching Plano Progresso cache rows;
- Plano Progresso fulfilled/excess hours that diverge from summed Horas Aplicadas;
- duplicate/colliding stable IDs and orphaned cross-sheet references.

Data Health should sort or present the most severe issues first.

Current UX alignment:

- The guard button lives in the global bottom menu / hidden-menu action bar, not inside Configuracoes.
- The guard popup behaves like the other app popups: it does not close on random outside clicks, it closes by pressing the guard button again, its own close control, or another popup-producing global button.
- The guard icon uses the same base colors as other bottom buttons. If the highest issue severity is `warning` or `error`, show the count centered inside the shield in yellow/red. If the report is OK or info-only, no warning/error number is needed.
- User-facing guard text must use proper PT-BR characters. Mojibake such as `Ãƒ`, `Ã‚`, or replacement characters is a bug.

## Design Rules

- Add new Data Health rules whenever a new feature creates or depends on workbook data.
- Keep rules deterministic and explicit. Do not guess silently.
- Keep Data Health modular. Validation logic belongs in shared data modules, not scattered UI code.
- Reuse the same validation concepts for contextual red warning toasts when an action is invalid.
- Do not auto-repair frozen history by rewriting copied snapshot labels from current catalogs.
- Broken live references can block actions/imports. Broken historical references should usually warn and preserve proof.
- Schema/header normalization can reorder/export columns into the app's expected shape, with human-facing columns first and internal IDs at the end. Data Health focuses on whether values and relationships are coherent.
- Official privacy descadastro is different from a broken orphan reference. When the app officially descadastra an Aprendiz, it should remove that person's personal row plus dependent personal/history/progress/document rows according to the privacy purge rules. A remaining Presenca for a missing Aprendiz should therefore be treated as a serious integrity problem caused by manual workbook manipulation, old data, or an incomplete purge path.

## Future Work

The guard is expected to grow with the app. Future areas that should add rules:

- Documentos and generated document indexes/templates;
- Empresas and contracts, once their workflow is defined;
- Ementa/Arco document source lifecycle and removal/update rules;
- document files/folders tied to Aprendizes, Empresas, Turmas, or generated proof;
- any new action that creates, deletes, or relinks source data.

The current UI inside `Configuracoes` is temporary. The product can later present the same underlying issues through a better worker-facing panel, action-specific warnings, or document-readiness checks.
