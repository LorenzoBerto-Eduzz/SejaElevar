# AI Memory Protocol

This file exists to reduce problems caused by short or stale AI chat memory. The repo is the durable memory for this project; chat context is helpful but temporary.

Use this protocol when starting a session, returning after a long conversation, touching an older system, switching machines, or feeling even slightly unsure about how a feature fits together.

## Core Rule

Do not rely on remembered chat context for important project behavior.

If a detail matters for code, workflow, architecture, tuning, or the user's intent, recover it from repo files, code comments, Git history, or focused docs before editing.

## Refresh Before Editing

Before changing a feature or system:

1. Read `AGENTS.md`.
2. Read `docs/AI_HANDOFF.md`.
3. Read `docs/WORKFLOW_AND_STYLE.md`.
4. Check `git status --short --branch`.
5. Inspect the actual files you will edit.
6. If the feature has a focused memory doc in `docs/`, read that doc too.
7. If the current chat memory conflicts with the repo, trust the repo and ask the user if the intent is unclear.

## When Memory May Be Stale

Treat memory as stale when:

- The conversation has become long.
- The user says they pulled changes, switched machines, or another AI worked on the repo.
- The task touches a system that has not been discussed recently.
- The task depends on exact values, formulas, paths, command names, project settings, API contracts, or workflow rules.
- You are about to refactor, rename, delete, move, or introduce a shared system.
- You feel tempted to say "I think" about current code instead of checking it.

When memory may be stale, pause and inspect files before acting.

## What Belongs Where

Use repo files as different kinds of long-term memory:

- `AGENTS.md`: boot instructions and strict session-start behavior.
- `docs/AI_HANDOFF.md`: short current project snapshot for the next AI session.
- `docs/WORKFLOW_AND_STYLE.md`: collaboration and coding rules.
- `docs/AI_MEMORY_PROTOCOL.md`: how AI sessions prevent context loss and recover safely.
- `docs/PROJECT_ORGANIZATION.md`: folder and responsibility direction.
- `docs/TEMPLATE_SETUP.md`: how this template becomes a concrete project.
- `docs/OWNER_NOTES.md`: plain-language notes for the human developer.
- `docs/`: AI/project memory, durable design notes, architecture notes, and cross-session explanations.
- `notes/`: the user's personal/project scratch and tuning area. Do not add to or reorganize `notes/` unless the user explicitly asks.
- Code comments: local intent, tricky behavior, formulas, tweak points, and why a block exists.
- Git history: chronological record of completed changes.

Do not turn any one file into a full transcript. Prefer short, purposeful files that answer "what does a future AI need to know to continue safely?"

## Writing Durable Context

Write durable context when a decision or mechanic would be hard to reconstruct later.

When the user says `memcheck`, or uses similar phrasing such as "memcheck this all", "add this to memory", "keep long track of this", or "put this in project memory", store the useful outcome of the recent discussion as durable project memory. This is for moments where the user and AI discussed, planned, aligned, brainstormed, or named something and reached a useful settled direction.

`memcheck` does not mean save a transcript. It means preserve the distilled decision, vocabulary, plan, model, or design direction that future AI sessions need.

`memcheck` only updates the appropriate long-term memory files. It does not commit or push by itself. If the user wants memory updates plus Git continuity, they can ask for `gitcheck`.

1. Put the durable idea in the appropriate `docs/` file, creating or updating a focused doc if needed.
2. Add only a short pointer to `docs/AI_HANDOFF.md` if future sessions need to find it quickly.
3. Do not write to `notes/` unless the user explicitly says to use `notes/`.
4. Keep it concise and current, not a transcript.

## Owner Commands: memcheck And gitcheck

These are owner workflow commands, not shell commands.

### memcheck

When the owner says `memcheck`, the AI must thoroughly update durable project docs/meta memory so future AIs, future sessions, and other devices can continue with the same understanding. It should preserve distilled decisions, alignments, functionality, plans, workflow rules, data models, commands, pitfalls, and project vocabulary. It does not commit or push by itself.

### gitcheck

When the owner says `gitcheck`, the AI must perform `memcheck` first, then save the current project state to Git for continuity across AIs/devices.

The expected `gitcheck` flow is:

1. Update durable memory/docs as needed, just like `memcheck`.
2. Inspect the worktree and relevant diffs.
3. Run relevant checks for the project when practical.
4. Verify `.git-identity`, `git config user.email`, and `git config core.hooksPath`.
5. Stage the intended files.
6. Commit.
7. Push to the configured remote, unless the owner explicitly says not to.

`gitcheck` commit messages must use a concise title sentence followed by one or more `-` bullet points describing the completed changes.

Good durable context includes:

- The current purpose of a system.
- The files involved.
- Important formulas, values, commands, or contracts.
- How systems connect to each other.
- Which parts are core product logic and which parts are debug, temporary, tuning-only, visual-only, data-only, or integration-only.
- Why a behavior was chosen.
- What is temporary or experimental.
- What the user explicitly wants or does not want.
- Known pitfalls, such as local setup, editor settings, generated files, secret handling, test commands, or deployment steps.

## Modularity Memory

Future AI sessions should treat modularity as a project requirement, not optional polish.

When adding a system, ask what would need to be deleted if the user later removes that feature. The answer should usually be one module, one folder, one file, or one clearly named block, not a hunt through unrelated files.

Keep these responsibilities separate when practical:

- Product state and rules.
- Visual presentation or UI.
- Debug overlays and diagnostics.
- Runtime tuning or configuration tools.
- Saved tuning snapshots.
- Data definitions and schemas.
- Integrations and external service adapters.
- Tests and temporary test helpers.

For new features, prefer this question before editing:

```text
If this system is removed later, where exactly would I delete it?
```

If the answer is unclear, choose a cleaner boundary before implementing.

## Focused Memory Docs

When a feature becomes complex, create or update a focused memory doc under `docs/`.

Examples:

- `docs/PROJECT_ORGANIZATION.md` for folder and responsibility direction.
- `docs/DATA_MODEL.md` for important data structures.
- `docs/INTERACTION_MODEL.md` for user/product interactions.
- `docs/API_MODEL.md` for API boundaries and contracts.
- `docs/DEPLOYMENT_MODEL.md` for release and deployment rules.
- `docs/TESTING_MODEL.md` for testing strategy.

Focused memory docs should explain the mechanic or system clearly enough that a future AI can work on it after the original chat context is gone.

## Handoff Discipline

`docs/AI_HANDOFF.md` should stay concise. It is a snapshot, not a diary.

Update it only when the user asks, during a requested `gitcheck` when continuity needs it, or when the task is specifically about project documentation or AI workflow.

When updating it:

- Replace stale details instead of only appending.
- Mention current stable behavior, not every experiment.
- Point to focused docs for deep mechanics.
- Keep near-term next steps current.

## Uncertainty Behavior

If you cannot confidently recover the needed context:

1. Summarize what you verified from files.
2. Name what remains unclear.
3. Ask the user before editing.

Do not make broad changes from uncertain memory.
