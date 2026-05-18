# AI Handoff

This file is the portable continuity note for AI coding sessions working on this repo. Keep it short and update it as a current snapshot, not a diary or changelog.

## Current State

- Project name: `SejaElevar`.
- Project kind: local-first internal web platform / administrative tool.
- Main project folder: `project/`.
- Primary language/stack: planned initial stack is Vite + React + TypeScript for the browser UI, plus a small local Node service/backend for file access and document generation. No scaffold exists yet.
- Run command: unknown; no app scaffold exists yet.
- Test command: unknown; no app scaffold exists yet.
- Remote: not configured yet.
- Git: not initialized yet at the time this handoff was adapted.
- The repository is organized as an AI-ready project frame: actual source code in `project/`, durable project memory in `docs/`, user scratch notes in `notes/`, and raw/reference assets in `asset_staging/`.
- `AGENTS.md` is the boot file for AI sessions.
- `docs/AI_MEMORY_PROTOCOL.md` defines how durable memory works and how to avoid stale chat assumptions.
- `docs/WORKFLOW_AND_STYLE.md` defines collaboration and coding expectations.
- `docs/PROJECT_BRIEF.md` should hold the real project purpose, audience, stack, commands, constraints, and priorities once setup is complete.
- `docs/PROJECT_ORGANIZATION.md` records the current organization direction.
- `docs/DATA_AND_STORAGE.md` records the current local-first data/storage direction.
- `docs/TEMPLATE_SETUP.md` explains how to finish adapting the template and initialize Git.

## User Intent

The user wants to build SejaElevar as a browser-accessed platform for internal administrative work around apprentices/students, documents, document generation, course agendas/modules, companies, and progressively added tools.

The user wants the app UI in Brazilian Portuguese. Planning discussion may happen in English.

The first likely module is `Aprendizes`: list, search, filter, register/edit students, inspect related info, and eventually generate documents.

The user currently prefers a practical local-first file-based setup before deciding any hosted architecture. Files/spreadsheets/templates/logos are thought of as the initial "database". The most important first data source is the real apprentices/students spreadsheet, which should be usable both by manual spreadsheet editing and by app edits. Future hosting or sync should remain possible, but should not drive premature complexity.

The user is considering a future shared Google Drive folder as a workspace/database source, so multiple workers can use the same synced files/config instead of each PC drifting separately. This should be treated as a future-compatible storage path, not a requirement to overbuild immediately.

The intended release/data model is: app releases are separate from the data workspace. A user installs/runs the app, then chooses/imports a workspace. Imported spreadsheets, company logos, templates, generated documents, and config should be copied/kept in organized workspace folders. Later the workspace can be a Google Drive for desktop synced folder so multiple installed app instances share the same data.

The user also wants Git set up soon so the project can move across PCs and AI sessions, using the existing `memcheck` and `gitcheckpoint` workflow.

## Working Procedure For Future AI Sessions

1. Read root `AGENTS.md` first.
2. Read this file next.
3. Read `docs/AI_MEMORY_PROTOCOL.md`.
4. Read `docs/WORKFLOW_AND_STYLE.md`.
5. Read `docs/PROJECT_BRIEF.md` once it exists.
6. If placeholders remain or setup is being changed, read `docs/TEMPLATE_SETUP.md` and follow its AI adaptation rules.
7. Check `git status --short --branch` and avoid overwriting user work.
8. Read recent commits with `git log --oneline --decorate --max-count=10`.
9. Inspect actual source files before editing.
10. Ask or confirm before major structural changes.
11. If confused, limited, or uncertain, do not push through. Explain the uncertainty and ask before making changes.

## Suggested Near-Term Next Steps

- Initialize Git and create the first project-frame checkpoint when the user asks.
- Use `main` as the initial branch unless the user changes their mind.
- Decide how cross-PC sync should treat real operational data versus sample/anonymized data.
- Scaffold the app using the approved initial stack.
- First product slice: `Aprendizes` list over a local workspace spreadsheet, using anonymized/demo rows when committing examples.
- Decide the exact `Aprendizes` spreadsheet columns and whether the first app slice is read-only before editing support.

## Durable Decisions

- The repo, not chat memory, is the source of truth.
- `memcheck` means update durable memory docs only.
- `gitcheckpoint` means update docs if needed, commit current work, and push for cross-machine/AI continuity.
- Keep source code, durable docs, scratch notes, and raw/reference staging separated.
- Keep features modular enough that they can be removed or replaced without hunting through unrelated files.
- Keep the UI in Brazilian Portuguese.
- Start local-first and file-based; keep future hosting/sync possible through storage boundaries.
- Treat `asset_staging/` as staging/inbox, not the active app database by default.
- Keep app releases separate from the active data workspace.
