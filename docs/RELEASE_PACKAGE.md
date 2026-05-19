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

- Generate the app first from `project/` with `npm run build:single`.
- Create the package under a local ignored export folder such as `exports/SejaElevar/`.
- Do not commit generated export folders or zip files.
- The user can zip the folder themselves when needed; do not create a zip unless they ask.
- Keep the root of the package quiet: ideally only the entry HTML, `README.md`, and the base folders.
- This structure is a solid starting point, not permanent architecture. Add subfolders or new base folders later only when a new tool or workflow clearly needs them.
