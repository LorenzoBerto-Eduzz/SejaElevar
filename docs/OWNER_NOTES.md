# Owner Notes

This file is for the human owner. It explains what has been set up in the repo and why.

## What This Repo Is

This repository is the AI-ready project frame for `SejaElevar`.

SejaElevar is planned as a local-first internal web platform for managing apprentices/students, companies, course modules, agendas, documents, templates, and related administrative tools.

The actual source/product project lives inside:

```text
project/
```

Files outside that folder are still intentional. They are for project notes, AI handoff, workflow rules, owner guidance, or raw/reference assets that you want to keep outside the source project until they are needed.

## Current Outer Folder Structure

```text
SejaElevar/
  project/
    .keep
  asset_staging/
    .keep
  local_assets/
    .gitignore
  docs/
    AI_HANDOFF.md
    AI_MEMORY_PROTOCOL.md
    CHATGPT_PROJECT_INSTRUCTIONS.md
    OWNER_NOTES.md
    PROJECT_BRIEF.md
    PROJECT_ORGANIZATION.md
    DATA_AND_STORAGE.md
    TEMPLATE_SETUP.md
    WORKFLOW_AND_STYLE.md
  notes/
    todos.txt
  AGENTS.md
  .editorconfig
  .gitattributes
  .gitignore
```

Meaning of each part:

- `project/` is where the real code, app, game, site, tool, library, or platform goes.
- `docs/DATA_AND_STORAGE.md` records the current local-first storage direction for SejaElevar.
- `asset_staging/` is for raw/reference/transfer assets that you want to sync between computers but do not want inside the source project yet. It is an inbox/staging area, not the active app database by default.
- `local_assets/` is for local-only files that should stay on this machine and not be pushed to the remote.
- `local_data/` may be created later as the active local app workspace for real operational spreadsheets, templates, logos, generated documents, and config. It should stay out of Git unless the user explicitly chooses otherwise.
- The planned initial app stack is Vite + React + TypeScript for the browser UI, plus a small local Node service/backend for file access and document generation.
- `asset_staging/.keep` is a hidden placeholder so Git keeps the empty staging folder available on every machine.
- `docs/` holds project notes, human guidance, AI continuity, workflow agreements, and durable AI/project memory.
- `notes/` is your personal/project scratch and tuning area. AI should not add to or reorganize it unless you explicitly ask.
- `AGENTS.md` stays at the repo root because AI coding tools commonly look there first.
- `.editorconfig`, `.gitattributes`, and `.gitignore` stay at the repo root because they control editor and Git behavior for the whole repository.

## Important Commands

Use:

```text
memcheck
```

when you want AI to save the durable outcome of a discussion into the memory docs only.

Use:

```text
gitcheckpoint
```

when you want AI to update docs if needed, commit the current work, and push so another computer/session can continue.

## How AI Should Adapt The Template

When you start a new project from this template, the AI should not merely read the files and continue generically. It should adapt the frame to the actual project.

The main adaptation file is:

```text
docs/TEMPLATE_SETUP.md
```

The main project identity file is:

```text
docs/PROJECT_BRIEF.md
```

Ask the AI something like:

```text
Read AGENTS.md and docs/TEMPLATE_SETUP.md, inspect the project folder, then adapt this template to the actual project. Ask me for anything important you cannot infer safely.
```

The AI should preserve the memory system, but replace placeholder/template wording with real project facts as soon as those facts are known.

## Git Setup

This template includes Git helper files, but it does not include Git history.

For a new project, run:

```powershell
git init
git add .
git commit -m "Set up AI-ready project frame"
git branch -M main
git remote add origin <remote-url>
git push -u origin main
```

If you do not have a remote yet, skip the remote and push steps until later.

## Ground Rules

- Keep the actual source project inside `project/` unless you intentionally rename that folder.
- Keep raw or temporary assets outside the source project until intentionally imported or used.
- Keep the outer repo folder clean: source project, asset staging, local-only assets, docs, notes, root AI instructions, and root Git/editor config.
- Keep code simple and readable.
- Keep features modular and removable, especially prototype systems, debug tools, UI, visuals, data, integrations, and product rules.
- Use clear names.
- Add comments when they explain intent or tweak points.
- Avoid clever abstractions too early.
- Ask before major structural changes.
- When you ask for suggestions or recommendations, AI should suggest first and wait for approval before changing files.
- If AI seems confused, limited by model/account/tools, or unable to confidently understand the project, it should say that clearly and ask before changing files.
- Prefer small commits with messages descriptive enough to understand later from Git history.
- AI should not create commits or update docs/handoff notes unless you explicitly ask.
- When you ask for `memcheck`, AI should update long-term memory docs only. It should not commit or push unless you also ask for `gitcheckpoint`.
- When you ask for `gitcheckpoint` or a "git checkpoint", AI should update docs only if needed for future AI continuity, commit the current work, and push it so another computer can pull and continue.
