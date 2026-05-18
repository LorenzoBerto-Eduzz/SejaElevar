# ChatGPT Project Instructions

Paste or adapt these instructions into a fresh AI chat, ChatGPT Project, or coding assistant that cannot automatically read the repo rules.

```text
You are helping with SejaElevar, a local-first internal web platform / administrative tool.

The repository is the source of truth. Do not rely on old chat memory for important project behavior.

First read:
- AGENTS.md
- docs/AI_HANDOFF.md
- docs/AI_MEMORY_PROTOCOL.md
- docs/WORKFLOW_AND_STYLE.md
- docs/PROJECT_BRIEF.md
- docs/PROJECT_ORGANIZATION.md

If setup is still being adjusted, also read:
- docs/TEMPLATE_SETUP.md
- docs/OWNER_NOTES.md

The actual source project lives in `project/`.
Files outside that folder are intentional project frame files for AI memory, owner notes, scratch notes, and asset staging.

SejaElevar's UI should be in Brazilian Portuguese. The first planned product area is `Aprendizes`, a student/apprentice list and management area. The project should begin local-first with file-based data and a clean storage boundary so future sync/hosting options can be added later.

The planned initial stack is Vite + React + TypeScript for the browser UI, plus a small local Node service/backend for local workspace file access and document generation. Inspect `project/` before assuming commands or dependencies, because the app may not be scaffolded yet.

If this repo still contains template placeholders, follow docs/TEMPLATE_SETUP.md to adapt the frame to the actual project before serious implementation work. Preserve the memcheck/gitcheckpoint memory workflow, but replace generic template wording with real project facts once known.

Keep code simple, explicit, modular, and easy for the user to read.
Ask before major structural changes, broad renames, deleting files, changing branch strategy, or introducing a new framework.
When I ask for suggestions or recommendations, suggest first and wait for approval before editing.
Do not create Git commits unless I explicitly ask.
Do not update docs/AI_HANDOFF.md or docs/OWNER_NOTES.md unless I explicitly ask, or unless the task is specifically about documentation/workflow guidance.
If I ask for memcheck, update the appropriate long-term memory docs only. Do not commit or push unless I also ask for gitcheckpoint.
If I ask for gitcheckpoint or a "git checkpoint", inspect the current worktree, update project/handoff docs only if needed for future AI continuity, commit the current work, and push it so another computer can pull and continue.
If you are confused, missing tools, limited by model/account capability, or cannot confidently understand the repo state, stop before editing. Tell me plainly what you understand, what is unclear, and ask for confirmation.
```
