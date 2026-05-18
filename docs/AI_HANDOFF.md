# AI Handoff

This file is the portable continuity note for AI coding sessions working on this repo. Keep it short and update it as a current snapshot, not a diary or changelog.

## Current State

- Project name: `SejaElevar`.
- Project kind: local-first internal web platform / administrative tool.
- Main project folder: `project/`.
- Primary language/stack: planned initial stack is Vite + React + TypeScript for the browser UI, plus a small local Node service/backend for workspace file access and document generation. No scaffold exists yet.
- Run command: unknown; no app scaffold exists yet.
- Test command: unknown; no app scaffold exists yet.
- Remote: `origin` points to `https://github.com/LorenzoBerto-Eduzz/SejaElevar.git`.
- Git: initialized on `main`, tracking `origin/main`.
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

The project should prioritize practical functionality over fancy presentation at first: view data, search/filter it, edit it, and generate documents from that data plus values filled in through the web UI.

The first likely module is `Aprendizes`: list, search, filter, register/edit students, inspect related info, and eventually generate documents.

The user currently prefers a practical local-first file-based setup before deciding any hosted architecture. Files/spreadsheets/templates/logos are thought of as the initial "database". The most important first data source is the real apprentices/students spreadsheet, which should be usable both by manual spreadsheet editing and by app edits. Future hosting or sync should remain possible, but should not drive premature complexity.

The intended model has three separate layers:

- The dev/meta repo: source code in `project/`, durable docs, staging assets, notes, Git, and AI memory.
- The baked/local app: a simple browser-accessed tool that can be passed to a coworker for testing/use, ideally experienced as opening a local browser address/bookmark rather than running developer commands.
- The data workspace: operational spreadsheets, templates, logos/assets, generated documents, and config, kept out of Git.

The first data workspace can be pure local and populated by importing files into organized workspace folders. Later the same workspace model should be able to point at a Google Drive for desktop synced folder so multiple installed app instances stay on the same data, before considering formal Google APIs or hosting.

The user wants Git continuity through the existing `memcheck` and `gitcheckpoint` workflow.

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

- Scaffold the app using the approved initial stack.
- Keep the first UI simple and functional: workspace status, `Aprendizes` entry point, and placeholders for data/document tools.
- First product slice: `Aprendizes` list over a local workspace spreadsheet, using anonymized/demo rows when committing examples.
- Decide the exact `Aprendizes` spreadsheet columns and whether the first app slice is read-only before editing support.
- Add document generation after the workspace and apprentice listing flow are reliable.

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
- Use local workspace import/storage first; keep Google Drive synced folders and later Google APIs/hosting as future-compatible paths, not first implementation requirements.
