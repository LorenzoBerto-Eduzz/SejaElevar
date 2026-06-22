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
- The timetable visual grid renders real 15-minute rows aligned to the Aprendizes row height. It intentionally does not render 5-minute DOM/visual rows; future block movement/resizing should snap to thirds inside each 15-minute row to represent 5-minute increments.
- Timetable vertical scrolling should not be used. The expanded body should grow to fit the Turma's configured period plus a small visual tail after the end time, while the left Aprendizes list can scroll vertically when many Aprendizes are assigned.

For now a Turma is expected to have one weekday. The model should remain open to multiple weekdays later, where the same control could allow multiple checked days and the timetable could show multiple columns.

## Global Cronograma

The smarter long-term model is a global/universal Cronograma as the real source of scheduled events, with each Turma showing only the blocks assigned to it.

The `Calendário` tab should be the main global Cronograma visualization area. It should eventually let the user see scheduled events across Turmas, while each Turma can still show a filtered timetable view of the same global Cronograma data.

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

`Aula` should become its own tab/item type later, because workers need a friendly place to define and manage reusable Aula content.

An Aula item defines what content/activity exists and which Disciplinas it can cover. The date, time, duration, Sala, and Funcionario are defined by the Cronograma block where that Aula is scheduled.

Current planned workbook/catalog fields for reusable Aulas:

```text
ID
Aula
Cor
Instrutor Padrao
Sala Padrao
Disciplinas
```

Current planned workbook fields for scheduled Aula/Cronograma instances:

```text
ID
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
```

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

Current implementation priority: pause further Turma timetable/Aula-instance polish and move upstream to the Arcos/Disciplinas foundation. The next solid foundation is defining Arcos and their plano de ensino/ementa Disciplinas first, then using those Disciplinas as selectable coverage when building predefined Aulas, then returning to Cronograma blocks so each scheduled event can select a predefined Aula with real coverage.

## Aula To Disciplina Mapping

When creating/editing an Aula, the user defines which Disciplinas that Aula covers.

Important rule:

- An Aula may cover equivalent/related Disciplinas across different Arcos.
- An Aula should not count twice inside the same Arco.
- If the user tries to map one Aula to more than one Disciplina in the same Arco, the app should warn or block unless a future explicit split-time rule is designed.

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
