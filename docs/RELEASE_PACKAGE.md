# Release Package

This document records the current direction for the coworker-facing local app folder, sometimes called the release package, export app folder, baked app, or distributable app folder.

The release package is not the development repo. It is the simple folder the user can pass to a coworker for testing or use.

## Dev And Release Package Model

There are two local app packages, and they should have the same folder/file structure and feel like the same product:

- `project/dev/`: the dev package. The user tests here during normal development by opening `project/dev/SejaElevar.exe`.
- `exports/SejaElevar/`: the local generated release package. Generate/update this only when the user explicitly asks for a release/export/package; do not carry it through Git.

The dev package should be as close as possible to the release package so the user can test the real end-user flow before asking for a release. The allowed difference is that dev may include explicitly dev-only tools, such as live tuning sliders or alignment controls, used to refine the interface. The release package should hide/remove those dev-only controls and show only the final end-user app and end-user settings.

Before creating a release, make sure the approved dev state is baked into source defaults. The release should not surprise the user with different colors, spacing, alignment, icons, text encoding, app shell behavior, data import behavior, or folder structure.

## Current Shape

```text
SejaElevar/
  SejaElevar.exe
  SejaElevar.html
  README.md
  assets/
  dados/
  modelos/
  documentos_gerados/
```

## Folder Roles

- `SejaElevar.exe` is the friendly entry point. The worker can double-click it, pin it, or find it from Windows search. It starts the local provider and opens the browser UI.
- `SejaElevar.html` is the built browser UI served by the local provider. Users should not need to open it directly for normal use.
- `README.md` explains how to open/use the package. Use this filename, not `LEIA-ME.txt`.
- `assets/` holds app-owned/meta assets and future local app state/config files.
- `dados/` holds the organized input/working data fed into the tool. For Aprendizes, importing copies the selected `.xlsx` directly here as `Aprendizes_hhmmssddmmyy.xlsx`; importing a new workbook replaces the previous active workbook, and edits save back as a fresh timestamped workbook.
- `modelos/` holds document/template files used for generation.
- `documentos_gerados/` holds generated documents, especially temporary/recent outputs.

Do not include a separate `configuracao/` folder for now. Future user configuration or save-state files should live under `assets/` unless the product grows enough to justify a different structure.

## Provider Lifecycle

The release uses a small local provider bundled in `SejaElevar.exe`. This is not meant to be a permanent background service.

Current lifecycle:

- Opening `SejaElevar.exe` starts the local provider and opens a local browser address.
- The browser page sends heartbeats while it is open.
- Closing the page sends `/api/app/closed`, which requests immediate provider shutdown.
- If the close signal is missed, the heartbeat timeout is the fallback.

## Packaging Notes

- Generate the local release package from `project/` with `npm run export:release`.
- The script packages the already-tested app in `project/dev/`: it copies the dev executable and app assets, writes a release-mode HTML copy, adds `README.md`, and creates clean empty runtime folders under `exports/SejaElevar/`.
- Exporting does not rebuild source or republish `SejaElevar.exe`. If source changed since the user last tested dev, refresh dev first with `npm run build:single`, test it, and only then export.
- Generating a release replaces the previous `exports/SejaElevar/` package, including its runtime data folders. Never use that export folder as the only copy of real operational data.
- Do not rebuild/give the release package during normal dev work. The user explicitly wants to continue testing in dev and only receive a release/export when they ask for it.
- Do not commit zip files.
- The dev package is tracked so another PC can pull a runnable/testable app package and generate its own release. The generated `exports/` folder is ignored by Git and stays local. Do not commit real operational/student data placed under `dados/`, `modelos/`, or `documentos_gerados/` unless the user explicitly chooses that after considering privacy.
- The user can zip the folder themselves when needed; do not create a zip unless they ask.
- Keep the root of the package quiet: ideally only the entry exe/html, `README.md`, and base folders.

## Dev/Release Parity Rule

The release package must match the approved dev app visually and behaviorally. Do not produce a release folder that has different alignment, colors, text encoding, icon behavior, menu state behavior, or app shell layout unless the user explicitly asks for a release-specific difference.

Dev testing currently happens in:

```text
project/dev/SejaElevar.exe
```

`project/dev/` mirrors the release folder shape but may expose dev-only tuning controls. Release mode should hide dev-only layout/alignment sliders and keep only real user-facing settings.

Do not mutate generated `SejaElevar.html` through encoding-unsafe text rewrites. Prefer the checked-in `project/scripts/export-release.mjs` script, or fix build scripts/source and copy generated files byte-for-byte.

## Dev-Only Vs Release Settings

Separate configuration into two categories:

- Dev-only tuning controls: temporary sliders or controls used while designing the app shell, such as exact layout offsets, icon/text nudges, logo positioning, and tab list start. These are for rapid visual tuning and should eventually be baked into source defaults, then hidden or removed from coworker-facing releases.
- Release/user settings: real options the coworker or operator should be able to change in normal use, such as brand colors, runtime company/logo choices, and future durable app preferences.

Current split: release mode shows only color configuration controls in `Configurações`. Dev-only layout/alignment tuning controls remain visible in normal dev builds and are hidden in exports by `window.SEJAELEVAR_RELEASE=true`.

Future AI must not assume every current `Configurações` control should ship. Before making a release, confirm which settings are dev-only and which are release-facing, or use the latest documented/user-confirmed split.
