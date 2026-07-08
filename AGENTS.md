# Agent Boot Instructions

This is the first file an AI coding session should read in this repository.

This template is for projects that may be continued across different machines, AI tools, models, or chat sessions. Treat the repository itself as the continuity source.

## Boot Or Catch-Up Sequence

Use this sequence when starting a fresh AI session, after switching machines, after `git pull`, after another AI/session checkpointed progress, or whenever the user asks you to catch up with the latest project state.

1. Read `docs/AI_HANDOFF.md`.
2. Read `docs/AI_MEMORY_PROTOCOL.md`.
3. Read `docs/WORKFLOW_AND_STYLE.md`.
4. Read `docs/PROJECT_BRIEF.md` if it exists or if the project purpose, audience, stack, or constraints matter for the task.
5. Read `docs/TEMPLATE_SETUP.md` if the project still contains template placeholders or setup is being changed.
6. Read `docs/OWNER_NOTES.md` when changing repo organization, documentation, workflow, or anything that affects how the user understands the project.
7. Check `git status --short --branch`.
8. Before any commit or push, check `.git-identity`, `git config user.email`, and `git config core.hooksPath`.
9. Review recent history with `git log --oneline --decorate --max-count=10`.
10. Inspect relevant changed files, recent commit diffs, or current project files instead of assuming prior chat context is available.
11. If this is an ongoing session, compare the latest repo state with your previous understanding and summarize what changed before continuing.

## Capability And Confusion Safety

- If you cannot confidently follow these instructions, inspect the repo, understand the current state, or keep track of the requested change, stop and tell the user plainly before editing.
- If your model/tool/account environment seems limited, missing capabilities, or unreliable for the requested task, say so and suggest a safer smaller step.
- If you are confused, summarize what you do understand, name what is unclear, and ask for confirmation.
- Do not make drastic changes while uncertain. Drastic changes include broad rewrites, structural moves, deleting files, changing workflow, changing project architecture, modifying many files at once, or changing branch strategy.
- Prefer a small read-only inspection or a proposed plan when confidence is low.

## Documentation Roles

- `AGENTS.md` is the boot file for AI sessions. Keep it short and directive.
- `docs/AI_HANDOFF.md` is the current transferable message for another AI session. Keep it concise and update it as a snapshot, not a diary.
- `docs/AI_MEMORY_PROTOCOL.md` is the rulebook for avoiding stale AI chat memory and recovering context from repo files.
- `docs/WORKFLOW_AND_STYLE.md` is the coding and collaboration agreement.
- `docs/PROJECT_BRIEF.md` is the product/project identity note: purpose, audience, stack, commands, constraints, and current priorities.
- `docs/PROJECT_ORGANIZATION.md` is the current organization direction for code, features, assets, docs, and shared foundations.
- `docs/TEMPLATE_SETUP.md` explains how to turn this template into a real project.
- `docs/OWNER_NOTES.md` is for the human developer. Update it only when the user asks or when the task is specifically about documentation/workflow guidance.
- `notes/` is the user's personal/project scratch and tuning area. Do not add to or reorganize `notes/` unless the user explicitly asks.
- `notes/todos.txt`, when present, is the user's personal scratchpad. Do not treat it as AI instructions unless the user explicitly asks you to read or act on it.
- `.git-identity` defines the single allowed Git contributor email for this repo.
- `.githooks/` contains tracked local hooks that block commits/pushes when local Git email differs from `.git-identity`. Each clone should enable it with `git config core.hooksPath .githooks`. `user.name` is not checked and may vary by device.

## Project Notes

- The actual code/product project lives in `project/` by default. This folder may be renamed during setup; if it is renamed, update this file, `docs/AI_HANDOFF.md`, and `docs/OWNER_NOTES.md`.
- Files outside `project/` are still intentional. They are for AI continuity, durable design memory, owner notes, raw/reference assets, and cross-device staging.
- If this repo still has template placeholders, follow the adaptation rules in `docs/TEMPLATE_SETUP.md` before doing project-specific implementation. Preserve the AI memory system while adapting the stack-specific details.
- `asset_staging/` is kept in Git with a hidden `.keep` placeholder so the empty organizational folder exists on every machine after pull.
- `local_assets/` is a local-only folder for assets/files that should not be pushed. Do not read, reorganize, or depend on it unless the user explicitly asks.
- This repo intentionally allows only `lorenzo.berto@eduzz.com` as the Git contributor email. Before `gitcheck`, commit, or push, verify the local Git email matches `.git-identity`; if it does not, stop and fix/ask instead of committing. The local Git name may vary by device because GitHub contributor attribution is tied to the email/account.
- Keep generated caches, dependency folders, local secrets, build outputs, and machine-specific files out of Git.
- Keep code simple, explicit, and easy for the user to read and change. Prefer clear names and small responsibilities over clever abstractions.
- Keep new systems modular by default. Debug tools, tuning UI, product logic, visuals, data definitions, and integration glue should live in separate files or clearly isolated blocks when practical.
- Add comments when they clarify intent, design decisions, or tweak points. Avoid noisy comments that merely repeat the code.
- Before major structural changes, ask or clearly confirm with the user.
- When the user asks for suggestions, recommendations, or "what do you think?", answer with options first and wait for confirmation before adding files, changing workflow, or editing project organization.
- Do not create Git commits unless the user explicitly asks.
- Do not update project documentation or handoff notes unless the user explicitly asks, or unless the requested task is specifically to change documentation/workflow guidance.
- When the user asks for `memcheck`, thoroughly update the appropriate long-term memory docs only. Do not commit or push by default.
- When the user asks for `gitcheck`, perform `memcheck`, inspect the worktree, run relevant checks, verify the Git identity guard, stage the intended files, commit the current work, and push to the configured remote unless the user says not to.
- `gitcheck` commit messages must use a concise title sentence followed by one or more `-` bullet points describing the completed changes.
- If the Git identity hook blocks a commit or push, do not bypass it. Configure the clone with the identity from `.git-identity` and keep `git config core.hooksPath .githooks` enabled.

## Root Layout

```text
SejaElevar/
  project/               actual code/product project
  asset_staging/         raw/reference/transfer assets outside the code project
  local_assets/          local-only assets ignored by Git
  docs/                  human and AI project memory
  docs/PROJECT_BRIEF.md  project identity and stack summary
  notes/                 user scratch/tuning/planning notes
  .git-identity          single allowed Git contributor email
  .githooks/             tracked local Git identity guard hooks
  AGENTS.md              this AI boot file
  .editorconfig          editor formatting defaults
  .gitattributes         Git line-ending and binary-file rules
  .gitignore             ignored local/generated files
```
