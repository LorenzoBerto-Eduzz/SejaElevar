# Project Organization Direction

This note captures the broad folder organization direction for when the project grows beyond the first few prototype files. Use it before moving folders, adding new major systems, or deciding where a new set of source files/assets should live.

## Core Rule

Keep files near the concept they belong to.

```text
Feature-specific files live with the feature.
Domain-specific files live with the domain concept.
Interface-specific files live with the interface.
Integration-specific files live with the integration.
Shared foundations live in shared/common folders.
```

The goal is to avoid huge folders full of unrelated files and to make deletion/replacement easy later.

## Project Frame

The root of the repo is the project frame:

```text
SejaElevar/
  project/
  asset_staging/
  docs/
  notes/
```

The actual product/source project lives in `project/`. The rest of the folders are there to help humans and AI collaborate safely.

If `project/` is renamed during setup, update this document and every root-level doc that mentions the main project folder.

## Expected App Organization

SejaElevar is expected to grow as a modular browser-based administrative platform. Once the stack is chosen, prefer feature/domain organization over large generic folders.

Possible future shape:

```text
project/
  src/
    features/
      aprendizes/
      empresas/
      cursos/
      agenda/
      documentos/
      configuracoes/
    shared/
      config/
      ui/
      validation/
    storage/
      local_files/
      adapters/
```

Use the local stack's conventions when they are strong. This doc is a direction, not permission to fight the framework.

The first planned feature pack is `Aprendizes`.

The app should also eventually have a workspace/settings area where the user can choose or import the active data workspace.

## Interfaces

Interfaces are user-facing or developer-facing ways to see or manipulate the system. This includes the browser UI, admin views, local tooling, previews, document generators, and any future import/export tools.

Keep temporary/debug interfaces separate from core product logic whenever practical, so they can be removed cleanly.

## Integrations

External services, files, APIs, databases, SDKs, and platform-specific glue should have clear boundaries.

For this project, "integration" includes local files as well as future services:

```text
project/
  src/
    integrations/
      local_files/
      google_drive/
      google_sheets/
```

This makes it easier to swap or remove an integration later.

## Shared Foundations

Shared files are for foundations genuinely used by many features, domains, or interfaces.

Examples:

```text
project/
  src/
    shared/
      config/
      logging/
      errors/
      test_helpers/
```

Use shared folders only when the file really is shared. Do not put feature-specific files in a broad shared folder just because it is convenient at first.

## Current Project Status

The template frame has been adapted for SejaElevar planning, but no real app scaffold exists yet.

`project/` remains the source/app folder. Do not add a framework or move the folder without confirming the stack choice with the user.

Do not perform broad reorganizations casually. If a folder move will change many imports, paths, generated files, or user understanding, confirm first and do it as one focused structural change.
