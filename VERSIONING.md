# Versioning Policy

This document defines what `email-connect` treats as a stable public contract.

## Current Policy

`email-connect` is still pre-1.0.

That means:

- patch releases must not introduce breaking changes
- minor releases may still introduce breaking changes while the product surface settles
- every breaking change in a minor release must be called out explicitly in release notes

Once the project reaches `1.0.0`, the package family should follow normal
semantic versioning:

- patch: bug fixes and non-breaking fidelity improvements
- minor: backward-compatible feature additions
- major: intentional breaking changes

## What Counts As Breaking

For this project, the following are public contracts:

- package names and install shapes
- exported runtime entrypoints from `email-connect`, `@email-connect/core`, `@email-connect/gmail`, and `@email-connect/graph`
- exported TypeScript signatures for documented public helpers
- provider-facing HTTP route availability
- documented control-plane HTTP routes
- documented control-plane request and response shapes
- provider-compatible OAuth route behavior
- continuation-link behavior where consumers are expected to follow returned links
- documented example code paths

The following are therefore breaking changes:

- removing or renaming a documented export
- changing a documented HTTP route path or method
- changing a documented success or error response shape in a non-additive way
- changing a continuation-link contract in a way that breaks stored or followed links
- moving a helper from the combined package to a provider package without keeping a compatibility path
- changing package composition so Gmail-only or Graph-only installs stop working as documented

## What Usually Does Not Count As Breaking

These are normally safe if they preserve documented behavior:

- adding new exports
- adding new optional fields to response bodies
- adding new generation knobs
- expanding provider realism while preserving documented semantics
- adding new examples or provider-specific helper APIs

## Combined Package API Policy

The root `email-connect` package is intentionally a curated convenience surface.

It should export:

- the combined engine/server experience
- high-value core generation and scenario helpers
- high-value Gmail and Graph helpers that make the combined package useful on its own
- shared public types from `@email-connect/core`

It should not become a dump of every internal symbol from every package.

If a caller wants the narrowest or most provider-specific API surface, the
provider package should be the primary documentation and install target.

## Package Boundary Policy

- `@email-connect/core` owns provider-neutral mechanics only.
- `@email-connect/gmail` owns Gmail-specific semantics.
- `@email-connect/graph` owns Graph-specific semantics.
- `email-connect` owns the convenience "both providers included" composition.

Changes that blur those boundaries should be treated as product decisions, not
incidental refactors.
