# Release Package

This document records the current direction for the coworker-facing local app folder, sometimes called the release package, export app folder, baked app, or distributable app folder.

The release package is not the development repo. It is the simple folder the user can pass to a coworker for testing or use.

## Current Shape

```text
SejaElevar/
  SejaElevar.html
  README.md
  assets/
  dados/
    planilhas/
  modelos/
  documentos_gerados/
```

## Folder Roles

- `SejaElevar.html` is the browser entry point. The end user should be able to open this file directly.
- `README.md` explains how to open/use the package. Use this filename, not `LEIA-ME.txt`.
- `assets/` holds app-owned/meta assets and future local app state/config files. This is for the app's background/composition assets, not ordinary operational data. Examples: favicon/page icon, app-owned brand assets, future config/save-state file.
- `dados/` holds the organized input data fed into the tool. Add subfolders as the data model becomes clearer, starting with `dados/planilhas/`.
- `modelos/` holds document/template files used for generation.
- `documentos_gerados/` holds generated documents, especially temporary/recent outputs.

Do not include a separate `configuracao/` folder for now. Future user configuration or save-state files should live under `assets/` unless the product grows enough to justify a different structure.

## Packaging Notes

- Generate the local release package from `project/` with `npm run export:release`.
- The script builds the single-file app and creates `exports/SejaElevar/`.
- Do not commit generated export folders or zip files.
- The user can zip the folder themselves when needed; do not create a zip unless they ask.
- Keep the root of the package quiet: ideally only the entry HTML, `README.md`, and the base folders.
- This structure is a solid starting point, not permanent architecture. Add subfolders or new base folders later only when a new tool or workflow clearly needs them.

## Dev/Release Parity Rule

The release package must match the approved dev app visually and behaviorally. Do not produce a release folder that has different alignment, colors, text encoding, icon behavior, menu state behavior, or app shell layout unless the user explicitly asks for a release-specific difference.

Current risk: dev tuning values may exist only in the developer browser's `localStorage`. Those values are not automatically part of source code or a fresh release package. Before producing a release intended for testing by a coworker, ask whether the current dev slider/color values should be baked into source defaults. If yes, get the current JSON from the app's `Valores atuais` panel and update the source defaults before building/exporting.

Do not mutate generated `SejaElevar.html` through encoding-unsafe text rewrites. The previous PowerShell HTML rewrite corrupted UTF-8 strings such as `Configurações` in the exported single-file app. Prefer the checked-in `project/scripts/export-release.mjs` script, or fix build scripts/source and copy generated files byte-for-byte.

## Dev-Only Vs Release Settings

Separate configuration into two categories:

- Dev-only tuning controls: temporary sliders or controls used while designing the app shell, such as exact layout offsets, icon/text nudges, logo positioning, and tab list start. These are for rapid visual tuning and should eventually be baked into source defaults, then hidden or removed from coworker-facing releases.
- Release/user settings: real options the coworker or operator should be able to change in normal use, such as brand colors, runtime company/logo choices, and future durable app preferences. These should persist in the release package's app state/config model when file persistence exists.

Current split: release mode shows only color configuration controls in `Configurações`. Dev-only layout/alignment tuning controls remain visible in normal dev builds and are hidden in exports by `window.SEJAELEVAR_RELEASE=true`.

Future AI must not assume every current `Configurações` control should ship. Before making a release, confirm which settings are dev-only and which are release-facing, or use the latest documented/user-confirmed split.
