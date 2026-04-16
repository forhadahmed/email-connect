# email-connect

`email-connect` is a standalone provider simulation harness for Gmail and Microsoft Graph mailbox flows and mailbox-connect OAuth flows.

It is designed to serve two equally important use cases from one canonical behavior engine:

- black-box use: a real HTTP server exposing Gmail-like and Graph-like API contracts for polyglot integration tests
- white-box use: an embeddable TypeScript SDK that lets tests drive mailbox state, time, replay, and failure injection directly

## Design Goals

- Canonical provider semantics, not app-specific business logic.
- One behavior engine shared by HTTP and in-process use.
- Deterministic mailbox scenarios for CI.
- Rich adversarial controls: replay, stale cursors, transient failures, auth failures, throttling, and data drift.

## Architecture

- `packages/core`
  - provider-neutral mailbox state, deterministic ids, clock, control plane, generation, and the generic HTTP host
- `packages/gmail`
  - Gmail-specific label, history, draft, attachment, userinfo, and connect semantics
- `packages/graph`
  - Graph-specific delta, draft, attachment, and connect semantics
- `src`
  - the combined convenience package that installs both providers for the zero-config path

## Project Contract

- App-specific policy does not belong in this repository.
- Provider identity and mailbox-state evolution do belong in this repository.
- HTTP and SDK surfaces must stay behaviorally equivalent.
- New fidelity should land in the canonical engine first, then get exercised through both SDK and HTTP tests.

## Package Shapes

You can consume `email-connect` in the simplest shape that matches your product:

- `email-connect`
  - combined convenience package with Gmail and Graph installed
- `@email-connect/core`
  - engine, control plane, generation, and generic HTTP host
- `@email-connect/gmail`
  - Gmail-only provider semantics, SDK helpers, and Gmail-only HTTP convenience helpers
- `@email-connect/graph`
  - Graph-only provider semantics, SDK helpers, and Graph-only HTTP convenience helpers

That lets a downstream product choose:

| Need | Install shape |
| --- | --- |
| Gmail only | `@email-connect/core` + `@email-connect/gmail` |
| Graph only | `@email-connect/core` + `@email-connect/graph` |
| Both providers, shortest path | `email-connect` |
| Both providers, explicit composition | `@email-connect/core` + both provider packages |

This repository is intentionally structured as a small monorepo around that
offering:

- `packages/core`
  - the provider-neutral package that both provider packages depend on
- `packages/gmail`
  - the Gmail-only package
- `packages/graph`
  - the Graph-only package
- `src`
  - the combined convenience wrapper published as `email-connect`

Typical install shapes look like:

```sh
# Gmail only
npm install @email-connect/core @email-connect/gmail

# Graph only
npm install @email-connect/core @email-connect/graph

# Both providers, convenience path
npm install email-connect
```

Typical usage looks like:

```ts
import { EmailConnectEngine } from '@email-connect/core';
import { getGmailClientForMailbox, gmailProvider } from '@email-connect/gmail';

const engine = new EmailConnectEngine({
  providers: [gmailProvider],
});

engine.createMailbox({
  id: 'ops',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

const gmail = getGmailClientForMailbox(engine, 'ops');
```

The longer-term product roadmap for taking this from the current strong
foundation to a polished external 10/10 offering lives in [TODO.md](./TODO.md).

The packaging and compatibility rules for the public API live in
[VERSIONING.md](./VERSIONING.md), and the release checklist for the package
family lives in [RELEASING.md](./RELEASING.md).

## Combined Package Policy

The root `email-connect` package is intentionally a curated convenience
offering.

It should expose the high-value combined surface:

- the combined engine/server
- core generation and scenario helpers
- the high-value Gmail and Graph helpers that make the convenience package
  useful on its own

It should not become a catch-all dump of every internal symbol from every
provider package. If you want the narrowest provider-specific install and
documentation boundary, prefer `@email-connect/gmail` or
`@email-connect/graph`.

## Status

This repository starts with:

- a deterministic mailbox engine
- a connect plane for mailbox OAuth flows
- Gmail and Graph mailbox facades
- Google-style and Microsoft-style authorization/token facades
- HTTP routes for the core read/sync/draft/attachment seams
- HTTP routes for `/authorize`, token exchange, refresh, revoke, and consent
- control-plane APIs for seed, replay, fault injection, and inspection
- provider-backed compose flows for direct send, reply drafts, and HTML-capable bodies
- deterministic email generation for quiet, steady, busy, and bursty inboxes
- consumer-facing white-box and black-box examples under [examples/](./examples/README.md)

Further fidelity work should extend provider semantics rather than bolt on test-only one-offs.

## Current Provider Fidelity

The current mail-plane implementation covers the seams that a consumer like
`microtms-next` actually exercises today:

- Gmail:
  - OAuth `/authorize`, `/token`, `/revoke`, and OIDC-style `userinfo`
  - consent approval/denial, auth codes, refresh tokens, and refresh-token omission on repeated offline auth without re-consent
  - Google incremental consent through `include_granted_scopes=true`
  - `users.getProfile`
  - `users.labels.list`
  - `users.messages.list/get/send`
  - `users.messages.attachments.get`
  - `users.history.list`
  - `users.drafts.create/send`
  - hidden labels, stale `historyId`, replayed history items, and history-type filtering
- Microsoft Graph mail:
  - Microsoft-style `/authorize` and `/token` flows with delegated mail scopes and refresh-token rotation
  - provider-shaped `access_denied` authorization redirects with `error_description`
  - `/me`
  - `/me/messages`
  - `/me/mailFolders/inbox/messages`
  - `/me/mailFolders/inbox/messages/delta`
  - message detail, message `$value`, attachments list/get, and attachment `$value`
  - `Prefer: outlook.body-content-type="text" | "html"`
  - `createReply`, draft create/patch/send, direct `sendMail`, and draft delete
  - move/copy and large-attachment upload sessions
  - typed Graph attachments: file, reference, and item attachments
  - stale delta tokens, opaque continuation links, inline attachment omission, and HTML-capable compose bodies

## Generation Model

`email-connect` treats mailbox simulation as a data-plane problem, not just an
endpoint-mocking problem.

Today you can generate mail from:

- corpus-backed template arrays
- programmatic callbacks
- deterministic timeline profiles:
  - `quiet`
  - `steady`
  - `busy`
  - `bursty`

Generation supports:

- sender/recipient pools
- reply/thread density controls
- attachment injection
- deterministic seeded output
- realistic thread headers such as `In-Reply-To` and `References`

That keeps tests close to user intent:
"simulate a busy inbox with deep threads" instead of "insert 500 rows."
The examples and workload language are intentionally not limited to one domain,
so the same engine can model logistics dispatch, insurance intake, or other
document-heavy operational inboxes.

## Fault Injection

Backend config supports:

- latency
- transient failures: `429`, `503`, `timeout`, `disconnect`
- auth failures: `invalid_grant`, `forbidden`

Operation filters intentionally accept both:

- provider-qualified names such as `gmail.history.list`
- consumer-friendly names such as `history.list`

That keeps the public harness ergonomic while staying compatible with the
operation naming patterns already used in `microtms-next`.

## Connect Plane Notes

The current connect plane focuses on mailbox-connect flows rather than general
identity-login product behavior.

That means:

- provider-side OAuth and consent behavior is in scope
- mailbox grant state is linked to the simulated mail plane
- app-local session behavior is still out of scope

For a consumer like `microtms-next`, that is the intended split:

- `email-connect` owns provider `/authorize`, consent, code exchange, token
  refresh, revoke, and mailbox capability effects
- the consuming app still owns its own browser session, tenant routing, and
  application-auth concerns

## Examples

The examples are intentionally written against the public packages rather than
workspace-relative internals:

- Gmail examples use `@email-connect/gmail`
- Graph examples use `@email-connect/graph`
- generation examples show explicit `@email-connect/core` + provider composition

That makes the example set double as packaging documentation for downstream
consumers. The current set includes both logistics-style operational flows and
an insurance claim-intake pipeline.
