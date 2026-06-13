# Workflow And Style

This project should stay easy for the user to understand, edit, and maintain while working with AI assistance.

## Collaboration Rules

- Explain the intended change before editing when the change affects structure, architecture, or workflow.
- Ask or confirm before major changes: moving folders, renaming many files, deleting files, changing branch strategy, introducing new frameworks/addons, changing deployment flow, or rewriting established code.
- If the user is asking for suggestions, recommendations, or "what do you think?", do not implement the suggestion yet. Present the recommendation and wait for the user to approve it.
- If the AI is confused, underpowered for the task, missing needed tools, or cannot confidently understand the current repo state, it should stop and say so before editing.
- When uncertain, the AI should summarize what it understands, name what is unclear, and ask for confirmation.
- Keep changes small enough that the user can review them in source control.
- Prefer one coherent feature/system step per commit.
- Use objective commit messages that make history useful. A small one-part change can use a short subject only; a checkpoint with several meaningful edits should use an identifiable subject that names the main areas covered, plus a brief body listing what changed.
- Do not create Git commits unless the user explicitly asks.
- When the user edits files, assume their changes are intentional. Read the current file before editing and work with their changes.
- Do not update project documentation or handoff notes unless the user explicitly asks, or unless the requested task is specifically to change documentation/workflow guidance.
- Do not rebuild or hand over `exports/SejaElevar/` unless the user explicitly asks for a release/export/package to test or pass to a coworker. Normal feature work should stay in dev.
- A user request for `memcheck` means: update the appropriate long-term memory docs with the distilled outcome of the recent discussion. It does not mean commit or push.
- A user request for `gitcheckpoint` or a "git checkpoint" means: inspect the current worktree, update project/handoff docs only when needed for future AI continuity, make a focused commit, and push it to the remote.
- During git checkpoints, do not stage/push `project/dev/SejaElevar.exe` just because a normal frontend build touched the dev package. The launcher is a large Git LFS file and should only change when launcher/provider inputs actually change. The build script keeps a launcher fingerprint so routine React/CSS/doc work can refresh dev HTML/assets without churning the exe.
- Checkpoint commit messages should let the user understand the commit later from `git log`/`git show` without needing the chat. Mention the main implementation, docs/workflow updates, tuning/config changes, and notable file/structure changes when they are part of the commit.
- Commit message format should be an objective subject line, then a blank line, then real newline-separated `-` bullet lines when a body is useful. The subject may be a longer title when needed, and should include recognizable words for the main commit areas so the user can identify the commit from `git log --oneline`. Do not put literal `\n` text in commit bodies.

## Code Style

- Prefer simple, explicit code over clever code.
- Use clear names that describe product meaning, not vague abbreviations.
- Keep modules focused on one responsibility when practical.
- Keep features modular enough that debug tools, prototype mechanics, UI, data, integrations, and core product logic can be removed or replaced without hunting through unrelated code.
- Debug overlays, tuning panels, diagnostics, and temporary test helpers should live outside core product code once they grow beyond a tiny helper.
- Avoid large manager modules unless the project has a clear need for them.
- Use configuration for values the user is likely to tweak.
- Put related concepts in predictable folders.
- Keep comments useful: explain intent, tradeoffs, important framework behavior, or tweak points.
- Do not add comments that simply restate each line of code.

## Project Structure Preference

The actual product code should live inside `project/` by default.

A common starting shape is:

```text
project/
  src/
  assets/
  tests/
```

Adjust this to the real stack. A website, app, game, plugin, library, automation, data tool, or backend may need a different internal structure.

The root folders outside `project/` should stay focused:

- `docs/` for durable project memory and workflow.
- `notes/` for user scratch/tuning/planning.
- `asset_staging/` for raw/reference/transfer files not yet part of the source project.

Do not create many empty folders just for theory. Add structure when it makes the next step clearer.

## Outside-Project Files

Files outside `project/` are allowed and intentional. They are useful for:

- AI continuity and workflow docs.
- Raw assets that are not ready to import or use.
- Reference material.
- Cross-device transfer/staging files.
- Personal notes.

Use `asset_staging/` for raw or transferred assets that should not yet become product/source assets. Move assets into `project/` only when they are intentionally part of the actual project.
