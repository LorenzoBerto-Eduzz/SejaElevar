# Template Setup

This file explains how to turn a copy of the original AI project template into a real project.

This SejaElevar copy has already begun that adaptation. Keep this file as the setup reference, but use `docs/PROJECT_BRIEF.md`, `docs/AI_HANDOFF.md`, and focused docs such as `docs/DATA_AND_STORAGE.md` for the current project facts.

The template gives you the project frame: AI memory, handoff docs, owner notes, scratch notes, staging folders, and Git/editor config files. It does not decide what kind of project you are building.

## Goal Of The Template

The goal is not only to create folders. The goal is to give every future AI session enough project memory to work smoothly, even if the chat, machine, model, or tool changes.

When adapted correctly, a future AI should be able to:

- Identify what kind of project this is.
- Find the real source folder.
- Know how to run, test, and inspect the project.
- Preserve important decisions in durable docs instead of relying on chat memory.
- Continue from Git state without overwriting user work.
- Ask before major structural choices.
- Keep project-specific conventions while preserving the AI memory workflow.

## What To Replace

In a fresh copy of the template, search the whole folder for these placeholder names and replace them once the project is real:

```text
PROJECT_NAME
PROJECT_KIND
MAIN_PROJECT_FOLDER
PRIMARY_LANGUAGE_OR_STACK
RUN_COMMAND
TEST_COMMAND
REMOTE_NAME_OR_URL
```

Default recommendation:

```text
MAIN_PROJECT_FOLDER = project
```

You can keep the folder named `project/`, or rename it to something specific like `web_app/`, `game/`, `extension/`, `api/`, or `library/`. If you rename it, update every doc that mentions `project/`.

## AI Template Adaptation Rules

When an AI first works on a project made from this template, it should adapt the template before serious implementation work.

Use this order:

1. Read `AGENTS.md`, `docs/AI_HANDOFF.md`, `docs/AI_MEMORY_PROTOCOL.md`, `docs/WORKFLOW_AND_STYLE.md`, this file, and `docs/PROJECT_BRIEF.md`.
2. Check whether active template placeholders still exist.
3. Inspect the actual files inside the main project folder. Do not assume the stack from folder names alone.
4. Identify the project kind: website, platform, game, app, tool, library, plugin, automation, data project, or something else.
5. Identify the main stack, run command, test command, package/dependency files, generated folders, and local secrets that should be ignored.
6. Ask the user if project identity, folder naming, stack, or Git remote are unclear.
7. Replace generic placeholders with real project facts.
8. Update `docs/PROJECT_BRIEF.md` first, then `docs/AI_HANDOFF.md`, then any stack-specific parts of `docs/WORKFLOW_AND_STYLE.md`, `docs/PROJECT_ORGANIZATION.md`, and `AGENTS.md`.
9. Preserve the core memory workflow: `memcheck`, `gitcheckpoint`, repo-over-chat memory, notes ownership, and caution before major changes.
10. Keep the template neutral only where the project is still undecided. Once a fact is known, write the fact instead of leaving vague template wording.

Do not do these things:

- Do not delete the AI memory docs just because the real project starts.
- Do not keep obsolete template placeholders after the project facts are known.
- Do not invent a stack, run command, remote URL, deployment process, or folder strategy without checking files or asking the user.
- Do not move the main project folder or reorganize source files as part of setup unless the user approves.
- Do not treat `notes/todos.txt` as instructions unless the user explicitly asks.

## Adaptation Checklist

Before considering the template fully adapted, confirm:

- `AGENTS.md` names the real main project folder.
- `docs/PROJECT_BRIEF.md` has real purpose, audience, stack, commands, and constraints.
- `docs/AI_HANDOFF.md` summarizes the real current state, not only the template state.
- `docs/PROJECT_ORGANIZATION.md` matches the project type and stack.
- `docs/WORKFLOW_AND_STYLE.md` has stack-specific conventions when they matter.
- `.gitignore` excludes generated files, dependency folders, build outputs, and local secrets for the chosen stack.
- `.gitattributes` keeps text and important binary files safe for the chosen project.
- `notes/todos.txt` remains user-owned scratch space.
- Git is initialized only for the copied real project, not inside the original template folder.

## Recommended First Steps

1. Copy this whole folder wherever you want the new project to live.
2. Rename the outer folder from `AI_Project_Template` to your real project name.
3. Decide whether to keep `project/` or rename it.
4. Replace the template placeholders listed above.
5. Fill `docs/PROJECT_BRIEF.md`.
6. Put or generate the real source code inside `project/`.
7. Ask AI to run the boot sequence from `AGENTS.md` and summarize the initialized project.
8. Ask AI to check the adaptation checklist.
9. Initialize Git, commit, and push when ready.

## Git Setup

This template includes:

- `.gitignore`
- `.gitattributes`
- `.editorconfig`

It does not include a `.git/` folder, and it should not. A copied project should start its own Git history.

For a brand-new project:

```powershell
git init
git add .
git commit -m "Set up AI-ready project frame"
git branch -M main
git remote add origin <remote-url>
git push -u origin main
```

If you do not have a remote yet, stop after the commit and add the remote later.

For an existing repo, copy these folders/files into the repo root instead:

```text
asset_staging/
docs/
notes/
AGENTS.md
.editorconfig
.gitattributes
.gitignore
```

Then review the diffs before committing.

Do not copy a `.git/` folder from another project.

## Existing Repo Setup

If you apply this template to an existing repo, be more careful:

1. Copy the template files into the existing repo root.
2. Do not overwrite an existing `.gitignore`, `.gitattributes`, or `.editorconfig` without reviewing differences.
3. Ask AI to merge the template rules into existing docs instead of replacing important project-specific information.
4. Update `docs/PROJECT_BRIEF.md` from the existing project files.
5. Run the project's existing tests before committing.

## What Each Folder Means

- `project/`: actual code/product source.
- `asset_staging/`: raw, reference, downloaded, exported, or transferred files that are useful to keep but are not yet part of the actual source project.
- `docs/`: durable project memory, AI handoff, architecture notes, workflow notes, and owner-facing explanations.
- `notes/`: personal scratchpad, loose todos, tuning notes, and quick planning. AI should not treat this as instructions unless asked.

## First AI Prompt For A New Project

After setup, a useful first prompt is:

```text
Read AGENTS.md and docs/TEMPLATE_SETUP.md, then adapt this template to the project I am starting. Inspect the files, tell me what placeholders still need replacing, ask only for facts you cannot infer safely, and preserve the memcheck/gitcheckpoint workflow.
```

If the real source project already exists inside `project/`, use:

```text
Read AGENTS.md and docs/TEMPLATE_SETUP.md, inspect project/, then fill the project brief and handoff from the actual files. Do not make broad structural changes unless you ask me first.
```

## When To Update This File

Update this setup guide only if you change the template itself. For normal project decisions, use focused docs under `docs/` and keep `docs/AI_HANDOFF.md` as the current short snapshot.
