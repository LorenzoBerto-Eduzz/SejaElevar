# Academic And Scheduling Model

This note captures the planning alignment from June 12, 2026, around how Aprendizes, Turmas, Aulas, Cronograma, Arcos, Disciplinas, attendance, and completion/proof should work. It is a durable product model, not an implementation checklist.

## Core Mental Model

The project should treat these concepts as separate layers:

```text
Turma brings the people.
Cronograma brings the time.
Aula brings the content.
Presenca/registro turns attendance into completed workload.
Plano de Ensino defines what each Aprendiz needs to complete.
```

The app should avoid overloading one item with multiple meanings. In particular:

- `Turma` is the group/container of Aprendizes.
- `Cronograma` is the schedule of what happens and when.
- `Aula` is reusable teaching/activity content.
- `Disciplina` is a curriculum requirement inside an Arco/Plano de Ensino.
- `Presenca` or a completed attendance record is historical proof that an Aprendiz attended a scheduled Aula and earned hours.

## Item Relationships

Current conceptual relationships:

```text
Aprendiz
  belongs to one Turma at a time
  belongs to one Arco
  belongs to one Empresa

Turma
  groups Aprendizes
  has a weekday for now
  has a time range/period for its timetable
  has default Funcionario and default Sala
  shows a filtered view of the global Cronograma

Aula
  reusable/predefined teaching item
  defines what Disciplinas it can cover
  does not own a fixed date/time by itself

Cronograma Global
  stores every scheduled block/event
  each block knows its Turma, date, start/end, type, Aula when applicable, Sala, and Funcionario

Turma Cronograma View
  filters the global Cronograma to the selected Turma
  shows only the dates/times relevant to that Turma

Presenca / Registro Realizado
  stores what actually counted historically
  connects Aprendiz + scheduled Aula block + attendance/completion proof
```

An Aprendiz cannot be in two Turmas at once, but can move to another Turma later. Past completed hours should remain historical and should not be lost by moving Turma.

## Turma, Periodo, And Timetable

For now, `Periodo` should not be treated as a full app item like Aprendiz, Empresa, or Aula. It is better understood as the Turma's timetable time range.

Preferred conceptual fields:

```text
Turma
  Nome
  Dia
  Inicio do periodo
  Fim do periodo
  Funcionario padrao
  Sala padrao
```

The current UI/data may still show `Periodo` as a human-readable value, but internally the app should eventually prefer structured start/end times.

The Turma timetable should be based on:

- the Turma's selected weekday
- the Turma's start/end time range
- 15-minute snapping for block placement/resizing

Current UI direction for the Turma expanded body:

- The expanded Turma body is split into a left Aprendizes list and a right Turma timetable preview.
- The divider between those two areas is draggable in dev and persists the chosen percentage locally; approved values can be baked into source later.
- The left list is the assigned-Aprendizes view, with `+ Adicionar Aprendiz` behaving like the fixed bottom row for that list.
- The right timetable is currently the visual/planning surface for Aula/Cronograma blocks filtered to the Turma. It stores scheduled blocks in the global `Cronograma` worksheet and should keep reusable Aula definitions separate from scheduled instances.
- The timetable header shows the selected month/year and the dates for the Turma's selected weekday in that month.
- The timetable visual grid renders real 15-minute rows using a compact schedule-specific row height, currently independent from the Aprendizes row height so long periods fit with less vertical bulk. It intentionally does not render 5-minute DOM/visual rows; block movement/resizing snaps to thirds inside each 15-minute row to represent 5-minute increments.
- Timetable vertical scrolling should not be used. The expanded body should grow to fit the Turma's configured period plus a small visual tail after the end time, while the left Aprendizes list can scroll vertically when many Aprendizes are assigned.
- Overnight Periodos are valid. A range such as `23:00h - 10:00h` should be interpreted as starting at 23:00 and ending at 10:00 on the next day, with timetable labels wrapping through `00:00`, `01:00`, and so on instead of treating the range as invalid.
- Turmas value edits, including selecting an existing Periodo from the dropdown, should commit to the unified active `DadosElevar` workbook and immediately update the visible Turma row/timetable. The Turmas save path should replace only the `Turmas` sheet inside the active workbook, serialize writes, rebuild indexes, and never let tab switching or stale re-reads erase recently created/edited Turmas.

For now a Turma is expected to have one weekday. The model should remain open to multiple weekdays later, where the same control could allow multiple checked days and the timetable could show multiple columns.

## Global Cronograma

The smarter long-term model is a global/universal Cronograma as the real source of scheduled events, with each Turma showing only the blocks assigned to it.

The `Calendário` tab should be the main global Cronograma visualization area. It should eventually let the user see scheduled events across Turmas, while each Turma can still show a filtered timetable view of the same global Cronograma data.

Current UI alignment: event blocks are a shared surface across the global `Calendário` view and filtered Turmas timetable views. The same scheduled instance should look, display, and edit the same way wherever it appears. Avoid building separate Calendar-only and Turma-only block behavior unless a context truly requires a wrapper. Event blocks now expose the linked `Turma` value as part of the block's displayed/editable instance data, so an event can be assigned or reassigned to a Turma from the block itself; in a Turma timetable, changing that Turma value should naturally make the block leave the current filtered view and appear in the other Turma/global view.

Each Cronograma block should know:

```text
ID
Turma
Data
Inicio
Fim
Tipo: Aula / Intervalo / Outro
Aula ID, when created from a reusable Aula
Aula, copied display name used by this scheduled instance
Sala
Funcionario
Cor
```

Durable data split: `Aula` and `Cronograma` are related but not the same item. An `Aula` is the reusable model/catalog definition: what content exists and what defaults it carries. A `Cronograma` row is the scheduled instance: when, where, for which Turma, and with which copied/overridden values that occurrence will happen. The scheduled instance should keep its own copied values so old/future blocks do not silently mutate just because the reusable Aula definition changes later.

The Turma page can display a filtered monthly timetable. For a Turma whose day is Wednesday, the view can show all Wednesdays in the selected month as full rows/columns rather than a normal month grid. The width should allow the block content and dropdowns such as Sala/Funcionario to be usable.

`Intervalo`/breaks should be schedule blocks too, not Aulas. They block time and do not generate hours. A global/default interval rule may be useful later, but the implementation should stay modular so breaks can become manual or configurable if the real workflow requires it.

## Aulas

`Aula` is its own tab/item type because workers need a friendly place to define and manage reusable Aula content.

An Aula item defines what content/activity exists and which Disciplinas it can cover. The date, time, duration, Sala, and Funcionario are defined by the Cronograma block where that Aula is scheduled.

Current planned workbook/catalog fields for reusable Aulas:

```text
Aula
Cor
Instrutor Padrao
Sala Padrao
ID
```

Current planned workbook fields for Aula coverage:

```text
Aula ID
Aula
Arco
Modulo
Disciplina
Disciplina ID
ID
```

Current planned workbook fields for scheduled Aula/Cronograma instances:

```text
Turma
Data
Inicio
Fim
Tipo
Aula ID
Aula
Instrutor
Sala
Cor
ID
```

Current implementation state: the Aulas tab has the first editable catalog foundation and the first Aula-to-Disciplina coverage assignment foundation. It reads/writes the active workbook `Aulas` sheet, shows Aula rows/cards, lets the user create a draft Aula by committing a unique non-empty name, edit the Aula name/default Instrutor/default Sala/color, and delete an Aula with confirmation. Deleting an Aula removes the Aula template row and linked `Aulas Disciplinas` rows. It must not delete Cronograma rows: unconfirmed/planning events that referenced the Aula keep their date/time/Turma but have `Aula`, `Aula ID`, and `Cor` cleared so the user can select another Aula; events that already have a current `Presente` keep their stored snapshot values untouched as historical proof. Undo/redo for Aula deletion restores or re-clears those future Cronograma Aula references without rewriting historical `Presencas`/`Horas Aplicadas`. Coverage is stored in `Aulas Disciplinas` rows, chosen from the current imported Disciplinas catalog, and shown in Aulas as `Modulo  |  Disciplina` chips/elements with a per-Aula add/select flow. The current visual state is acceptable enough to pause visual tuning: coverage chips sit below the Aula row, wrap four per row, show ellipsis only when clipped, expand downward only when needed, and do not expose a normal delete `X` affordance for now. The next step is to strengthen the data rules, then use selected coverage rows when Cronograma/Presenca starts counting completed workload.

Current alignment: Cronograma blocks should select a predefined Aula from the Aula catalog. The timetable should not create new Aula definitions directly. `Aula ID` may be blank only while a newly placed scheduled block is still an incomplete draft waiting for the user to select a predefined Aula. Once an Aula is selected, the Cronograma row stores the `Aula ID` plus copied values such as Aula name, color, default instructor, and default room. The scheduled instance can later override instance values such as instructor and room without rewriting the Aula catalog item.

From the Turma timetable, the user should eventually be able to:

- pick an existing Aula from the Aula catalog
- not create a new Aula directly; Aula creation belongs in the Aulas flow after Arcos/Disciplinas exist

When an Aula is placed in a Turma's Cronograma, the block should default to the Turma's default Funcionario and Sala, but the block should allow overriding both through dropdowns.

For now, `Funcionários` and `Salas` do not need their own main sidebar tabs. Treat them as supporting/configured linked values used by Turmas, Aulas, and Cronograma blocks. They can become full item-management sections later only if the real workflow needs that.

## Arcos, Modulos, Disciplinas, And Ementa

Each Arco has an ementa/plano de ensino: the list of Disciplinas and required hours that Aprendizes in that Arco must complete.

The current known structure of Arcos is:

```text
Arco
  Plano de Ensino / Ementa
    Modulo Inicial
    Modulo Basico
    Modulo Especifico
```

All current Arcos share the same `Inicial` and `Basico` modules, with the same general Disciplinas. The `Especifico` module changes per Arco.

This suggests:

```text
Disciplina Geral
  applies to all Arcos
  belongs to Modulo Inicial or Modulo Basico

Disciplina Especifica
  belongs to one Arco
  belongs to Modulo Especifico
```

`Modulo` does not need to be a main tab/item unless later needed. It can start as a fixed/category property of Disciplinas: `Inicial`, `Basico`, `Especifico`.

`Disciplina` also does not need its own main tab for now. Because Arcos are directly composed of their Disciplinas, the user-facing management for Disciplinas should live inside the `Arcos` tab/flow. Keep Disciplina as an internal data concept for Aula mappings, progress tracking, attendance proof, search, and document generation.

Current implementation state: deeper Turma timetable/Aula-instance polish is paused while the upstream Arcos/Disciplinas foundation is built. The first Arcos tab now reads the active `DadosElevar` workbook, displays `Arcos` horizontally, and reads `Disciplinas` grouped by shared module rows. The current direction is that Arcos/Disciplinas are derived from official Ementa PDF documents instead of manually edited in the Arcos UI. The Arcos tab imports an Ementa PDF with `Adicionar Arco`, stores a copy under the runtime `dados/ementas/` folder, parses the official mold, writes/updates the `Arcos` and `Disciplinas` workbook sheets, and displays the result as a read-only academic catalog. If the official PDF mold changes, update the parser rules modularly rather than changing the academic model.

Durable live-data rule: Arcos and Disciplinas are not a one-time setup step. The user can import another Ementa/Arco at any point during real app use. When that happens, the app must update the active workbook, rebuild/refresh the generated data index, broadcast the global data change, and immediately refresh all dependent UI/data paths: Arcos display columns, Aprendizes `Arco de Aprendizagem` dropdown options, Aulas coverage options, future Cronograma/Aula validation, and future Plano de Ensino/document generation. Do not let Aulas, Cronograma, attendance, or document flows keep stale startup snapshots of Arcos/Disciplinas.

Current Arcos/Disciplinas UI direction:

- `Ementa` is the external/source document concept, not a worksheet/entity name.
- `Arcos` is a workbook sheet with one row per Arco, including source-document tracking columns such as `Ementa ID` and `Arquivo Ementa`.
- `Disciplinas` is a workbook sheet with one row per Disciplina, including `Disciplina`, `Módulo`, `Arco`, `Carga Horária`, `ID`, and `Ementa ID`.
- The official Ementa PDF is the source for creating/updating an Arco and its Disciplinas. The parser currently targets the current Elevar official mold: course title line with `Título do curso: Arco Ocupacional ...`, module headings for `Módulo Inicial`, `Módulo Básico`, and `Módulo Específico`, and table rows with discipline name plus workload hours. It ignores the objective/description column. It must capture every real table row with a carga horária value in the third column, including rows whose Disciplina name wraps across multiple lines or appears just below the carga horária line in PDF text extraction. Current local validation against the known Ementa PDFs expects `Inicial = 3`, `Básico = 15`, and the respective `Específico` rows for each Arco.
- Ementa parsing must only create Disciplinas from the official curriculum/module table rows. Later descriptive sections such as uppercase `CONTEUDOS ABORDADOS` may cite modules, discipline-like names, and hours for explanation, but those citations are not Disciplinas and must be ignored. Current parser logic treats real table rows as rows anchored in the left Disciplina column and stops parsing when the later standalone contents section begins.
- `Inicial` and `Básico` Disciplinas parsed from an Ementa are stored/displayed as shared `Arco = Todos`; `Específico` rows are stored/displayed only for the parsed Arco.
- The Arcos tab displays Arcos as horizontal columns.
- Module buttons are shared full-width rows (`Inicial`, `Básico`, `Específico`) that expand/collapse across all Arcos at once.
- `Inicial` and `Básico` rows marked with `Arco = Todos` appear in every Arco column; `Específico` rows appear only under their matching Arco.
- Disciplina bubbles currently show name and carga horária and are read-only. There should be no manual edit/delete affordance for Arcos or Disciplinas in this tab unless the user reopens that product decision. The remaining hover-only Aulas/book affordance is for future inspection of which Aulas cover that Disciplina.
- The next Arcos UI work should be visual tuning: columns, spacing, module rows, discipline bubbles, text behavior, hours placement, and the Aulas icon area.
- After the Arcos visual is acceptable, `Arco de Aprendizagem` in Aprendizes should become a dropdown/reference field sourced from active imported Arcos, mirroring the current `Turma` dropdown behavior. This Aprendiz->Arco link is the later basis for the individual `Plano de Ensino`.

## Aula To Disciplina Mapping

When creating/editing an Aula, the user defines which Disciplinas that Aula covers.

Implementation direction: keep Aula coverage in a separate `Aulas Disciplinas` worksheet/entity rather than a comma-separated field inside `Aulas`. `Aulas` is the template/catalog row; `Aulas Disciplinas` is the link table from Aula to Disciplina. Store both readable labels and stable IDs where available so the workbook stays understandable in Google Sheets while the app can keep relationships stable.

The Aula coverage picker should always read the current active Disciplinas catalog from the workbook/generated index. If the user imports a new Ementa after the Aulas tab is already open, the Aulas coverage choices must update from the same live data source without requiring an app restart.

The coverage selector is a "select existing Disciplina" flow, not a free text creator. When adding or editing an Aula coverage element, the dropdown/search should show only currently valid, not-yet-selected options for that Aula. The display string should be compact and readable, currently `Modulo  |  Disciplina`; for specific-module options, the context should distinguish the Arco so the worker understands which Arco-specific Disciplina is being selected. If no valid Disciplina is selected and the draft loses focus, the draft coverage element should disappear rather than writing a partial row.

Document generation depends on this model being stable. The eventual `Documentos` flow should not invent separate document-only data when the academic model already owns the facts. It should consume stable indexed data from Aprendiz, Turma, Arco, Disciplina, Aula, Cronograma, Presenca/registro, and Plano de Ensino progress, plus explicit user-filled document parameters when a template needs values that are not source data.

Important rule:

- An Aula may cover equivalent/related Disciplinas across different Arcos.
- An Aula should not count twice inside the same Arco.
- For `Modulo Especifico`, an Aula should have at most one selected Disciplina per Arco.
- For shared/general `Inicial` and `Basico` Disciplinas, the Aula can cover the shared Disciplina and it applies to all Arcos that share it.
- If the user tries to map one Aula to more than one Especifico Disciplina in the same Arco, the app should warn or block unless a future explicit split-time rule is designed.

Example:

```text
Aula: Atendimento ao Cliente

Cobre:
  Arco Administrativo -> Disciplina Comunicacao Profissional
  Arco Comercio -> Disciplina Atendimento ao Cliente
```

If an Aprendiz from Arco Administrativo attends that Aula, the time counts toward the Administrative Arco's mapped Disciplina. If an Aprendiz from Arco Comercio attends the same scheduled Aula, the time counts toward the Comercio Arco's mapped Disciplina.

For shared/general Disciplinas in the Inicial/Basico modules, the Aula can cover the general Disciplina and it applies to all Arcos that share it.

## Attendance And Historical Proof

Planning and completion must be separate.

```text
Cronograma = planning/scheduling.
Presenca/registro = historical proof of what counted.
```

Marking an Aprendiz present in a scheduled Aula should create/preserve a historical record that snapshots the relevant data at the time:

```text
Aprendiz
Turma
Arco context
Aula
Disciplina covered
Data
Inicio/Fim
Duracao
Funcionario
Sala
```

Completed hours and future documents should be generated from these historical records, not directly from mutable planned Cronograma blocks alone.

This protects old student records. If an Aula definition, Disciplina mapping, or Cronograma block changes months later, past completed records should not silently change.

The same protection applies when Arcos/Disciplinas are later removed or become unresolved. Future removal flows should warn, preserve historical attendance/progress records with their copied snapshot values, and mark unresolved references for future planned data instead of silently deleting or rewriting old proof records.

## Editing Rules After Attendance Exists

Once attendance/completion has been checked for a block:

- Deleting the Cronograma block can show a warning that attendance/completion records exist.
- Deleting or changing the planned block should not automatically erase completed hours.
- Changing an Aula's Disciplina mapping later should not rewrite old completed records.
- Changing a block's time/duration after attendance was checked should not silently change completed hours.
- It may be better to block editing important fields once attendance exists, or require an explicit confirmation flow.

Durable rule:

```text
Planning can change.
Completed attendance records are historical proof and should not silently change.
```

Current implementation state:

- The active `DadosElevar` workbook now owns four managed academic sheets: `Plano de Ensino`, `Presencas`, `Horas Aplicadas`, and `Plano Progresso`.
- `Plano de Ensino` is generated from each Aprendiz's `Arco de Aprendizagem` plus the current `Disciplinas` catalog. It is the per-Aprendiz copy of what that Aprendiz needs to complete.
- `Presencas` stores one row per event block plus Aprendiz, with `Presente` / `Ausente` as the current v1 states. It snapshots the event block values at save time: Turma, date, start/end, Aula, instructor, room, and stable IDs.
- `Horas Aplicadas` stores one row per present attendance plus covered Disciplina. Only `Presente` creates applied-hour rows. If an Aula covers multiple Disciplinas, the full event duration counts once for each covered Disciplina.
- `Plano Progresso` is a recalculable cache derived from `Plano de Ensino` plus `Horas Aplicadas`; it is not manual truth. It tracks fulfilled hours and `Excedente` instead of truncating over-completion.
- Attendance save resolves Aula coverage against the Aprendiz's own `Plano de Ensino` before writing `Horas Aplicadas`, so shared `Inicial`/`Basico` coverage counts for the learner's Arco and progress uses the plan's canonical `Disciplina ID`.
- Managed academic sheets should keep human-facing columns first and app/internal IDs at the end. Header normalization tolerates old mojibake/double-encoded labels and duplicate managed headers, but new exports should use normal PT-BR labels.
- Event blocks are currently blocked from normal edit/move/delete only when at least one linked `Presencas` row is currently `Presente`. A checked-then-unchecked attendance path should no longer count as "the event happened"; if nobody is currently `Presente`, the event can still be edited/moved/deleted as a normal undoable planning action.
- Event blocks are "live planning" until they have a current `Presente` record. Unconfirmed blocks may still display live Aula catalog values such as Aula name/color through their `Aula ID`, so future scheduled blocks can follow Aula template edits. Once a block has at least one current `Presente`, its own Cronograma/Presenca snapshot values are the historical display/proof and must not be silently rewritten by later Aula/Turma/catalog edits.
- Reusable Aula template edits, coverage edits, or future deletes must not mutate old `Presencas`/`Horas Aplicadas`. Historical proof should keep the copied names, IDs, dates, duration, instructor, room, Turma, Aprendiz, Arco, and Disciplina context that was saved when presence counted.
- Changing an Aprendiz's `Arco de Aprendizagem` is blocked once that Aprendiz already has rows in `Horas Aplicadas`. Future explicit migration/transfer flows can be designed later, but simple field editing must not move existing Plano de Ensino progress into another Arco by accident.
- Presence validation should warn only for genuinely incomplete setup, such as trying to mark `Presente` on an event with no Aula selected or selecting an Aula that has no `Aulas Disciplinas` coverage rows at all. It should not block just because an Aula's coverage does not match a specific Aprendiz's Arco. In that mismatch case, the Presenca row may exist, while `Horas Aplicadas` only gets generated for coverage rows that resolve against the Aprendiz's own Plano de Ensino.

## Progress And Documents

Progress should be derived/calculated from source events and historical attendance records.

The `Documentos` tab should become the centralized place for document/template/generation workflows: all student documents, internal institution documents, template definitions, and generation buttons. Item popups such as Aprendiz details can still expose contextual document actions, but they should connect back to the same document-generation model rather than becoming isolated document systems.

The app should eventually be able to produce proof such as:

```text
Aprendiz: Ana
Disciplina: Comunicacao
Horas cumpridas: 2h
Origem:
  Aula: Atendimento ao Cliente
  Data: 12/06/2026
  Horario: 08:00-10:00
  Turma: Quarta Manha
  Funcionario: ...
  Sala: ...
```

The app should not rely on manually maintained total-hours fields as the main source of truth. Reports/documents may export totals, but the reliable source is:

```text
Cronograma block + Presenca/registro + Aula mapping + Aprendiz Arco
```

If a student moves to another Turma, their completed hours remain. Future schedule comes from the new Turma. If the new Turma later has an Aula covering a Disciplina the student already completed, that can happen; the app may warn later, but it should not break the model.

## Future Implementation Direction

Do not rush this whole model into code at once. Keep implementation modular and incremental.

Likely future areas:

- `Aulas` tab for reusable Aula definitions and Disciplina mappings.
- `Arcos` support for ementa/plano de ensino, including its Modulos, Disciplinas, and required hours.
- `Calendário` tab backed by a global Cronograma data foundation.
- Turma timetable view filtered from global Cronograma.
- Attendance/presence flow from scheduled Aula blocks.
- `Documentos` tab for templates, generation actions, and generated progress/proof records.

The existing generated data index remains the right direction: source files stay readable/plain, while the app builds internal normalized records and relationships for search, documents, and cross-tool logic.

Stable app-managed record IDs are part of this foundation. Rows in imported/source workbooks can gain a hidden `ID SejaElevar (não editar)` column so references between Aprendiz, Turma, Aula, Arco, Disciplina, attendance records, documents, and future search results do not depend only on row position or display names. The visible workbook should stay human-readable, but internal relationships should prefer these stable IDs when available.
