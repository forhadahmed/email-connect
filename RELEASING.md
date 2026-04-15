# Releasing

This document is the Phase 1 release checklist for `email-connect`.

## Before Version Bump

- [ ] Confirm package metadata is still correct in:
  - `package.json`
  - `packages/core/package.json`
  - `packages/gmail/package.json`
  - `packages/graph/package.json`
- [ ] Confirm README and package README install guidance still matches the actual package surfaces.
- [ ] Confirm any changed public behavior is reflected in [VERSIONING.md](./VERSIONING.md) and the release notes.

## Verification

Run the full verification set:

```sh
npm test
npm run check
npm run release:verify
```

`npm run check` is expected to cover:

- full build
- typecheck
- publish-hygiene verification with `npm pack --dry-run`
- built-artifact smoke validation against `dist` output

## Publish Hygiene

- [ ] Confirm `files` allowlists are still correct for all packages.
- [ ] Confirm package tarballs do not contain `src/`, `test/`, `examples/`, `packages/`, or `node_modules/`.
- [ ] Confirm tarballs do include the expected `dist/`, `README`, and `LICENSE` files.
- [ ] Confirm package READMEs are understandable without reading the workspace source tree.

## Public Contract Review

- [ ] Review exported root-package helpers and confirm the combined package remains curated rather than sprawling.
- [ ] Review provider package exports and confirm Gmail-only and Graph-only installs still work independently.
- [ ] Review control-plane and provider HTTP changes for breaking surface changes.
- [ ] Review continuation-link changes carefully; if a consumer-visible shape changed, call it out explicitly in release notes.

## Packaging Review

- [ ] Confirm `email-connect` still works as the combined convenience package.
- [ ] Confirm `@email-connect/core` + `@email-connect/gmail` still works as a Gmail-only install.
- [ ] Confirm `@email-connect/core` + `@email-connect/graph` still works as a Graph-only install.
- [ ] Confirm package smoke checks are running against built `dist` artifacts, not only workspace source imports.

## Publish

- [ ] Bump versions consistently across the package family.
- [ ] Generate or update release notes.
- [ ] Publish packages in dependency order:
  1. `@email-connect/core`
  2. `@email-connect/gmail`
  3. `@email-connect/graph`
  4. `email-connect`
- [ ] Verify install and smoke behavior from a clean temporary project after publish.
