# TODO

This document is the working roadmap for taking `email-connect` from its
current strong foundation to a polished 10/10 external product.

The intent is not to accumulate vague ideas. The intent is to preserve the
product shape, the sequencing, and the fidelity bar so future work stays
grounded.

## Current Context

`email-connect` already has the right architectural base:

- a provider-neutral core engine
- first-class provider packages for Gmail and Microsoft Graph
- a combined convenience package for "both providers"
- a white-box SDK story
- a black-box HTTP story
- a mail plane
- an initial connect plane
- deterministic generation and adversarial controls

That is enough to make the project legitimate.

It is not yet enough to call it finished.

The remaining work is mostly about:

- provider realism depth
- generation richness
- black-box product polish
- connect-plane maturity
- examples/docs/release quality
- operational packaging for external users

## What 10/10 Means

A 10/10 `email-connect` should feel like a real provider simulation platform,
not just a very good engineering harness.

That means:

- a Gmail-only buyer should feel they got a complete product
- a Graph-only buyer should feel they got a complete product
- a buyer using both should feel the mixed-provider experience is deliberate
- JavaScript users should get a first-class embeddable SDK
- non-JS users should get a first-class black-box server with stable control APIs
- connect flows should be realistic enough to catch live bring-up failures before production
- generated inboxes should feel plausibly human and operationally useful, not synthetic in a toy way
- documentation should make the product understandable without reading the source
- release/install/versioning should feel intentional and professional

## Non-Goals

These are useful guardrails so the product does not sprawl:

- This repository should not absorb app-specific business policy from `microtms-next`.
- This repository should not become a generic identity-login simulator for arbitrary products.
- This repository should not require a heavy plugin framework to stay modular.
- This repository should not optimize for "mock every API endpoint" over "model the provider seams that actually matter."
- This repository should not turn every fidelity gap into a one-off test-only shortcut.

## Guiding Principles

- [ ] Keep `core` provider-neutral. If a concept only exists because Gmail or Graph behaves a certain way, it belongs in the provider package.
- [ ] Keep the provider contract small. Add seams only when they are truly shared and canonical.
- [ ] Make the black-box server a first-class product, not a thin afterthought.
- [ ] Make the white-box SDK a first-class product, not a privileged internal path.
- [ ] Prefer deterministic controls over probabilistic magic in tests.
- [ ] Prefer realistic provider semantics over endpoint-count vanity.
- [ ] Keep checking `microtms-next` as a real consumer so the harness does not drift into irrelevance.
- [ ] Keep checking current provider reference docs so the mocks do not calcify around stale assumptions.

## Provider Fidelity Detour

This detour exists because the official-reference catalog pass made the next
high-value additions much clearer.

Primary reference catalogs:

- Gmail:
  [gmail.md](./gmail.md)
- Microsoft Graph:
  [graph.md](./graph.md)

Primary implementation seams to change:

- Gmail provider HTTP and connect behavior:
  [packages/gmail/src/provider.ts](./packages/gmail/src/provider.ts)
- Gmail mail-plane service behavior:
  [packages/gmail/src/service.ts](./packages/gmail/src/service.ts)
- Gmail scope and capability gating:
  [packages/gmail/src/capabilities.ts](./packages/gmail/src/capabilities.ts)
- Graph provider HTTP and connect behavior:
  [packages/graph/src/provider.ts](./packages/graph/src/provider.ts)
- Graph mail-plane service behavior:
  [packages/graph/src/service.ts](./packages/graph/src/service.ts)
- Graph scope and capability gating:
  [packages/graph/src/capabilities.ts](./packages/graph/src/capabilities.ts)
- Shared OAuth and grant lifecycle:
  [packages/core/src/connect/plane.ts](./packages/core/src/connect/plane.ts)

What is already solid enough that this detour should not re-solve it:

- Generic connect lifecycle: client registration, authorize, code exchange,
  PKCE, token refresh, revoke, and UserInfo shaping already exist in core.
- Gmail already covers `/authorize`, `/token`, `/revoke`, `/userinfo`,
  incremental consent, profile, labels, messages list/get, attachment fetch,
  history, draft create/send, and direct send.
- Graph already covers `/authorize`, `/token`, `/me`, message list, inbox list,
  delta, attachment metadata and `$value`, reply-draft creation, draft create,
  draft patch, draft send, and delete.

What this detour is for:

- Close the most valuable gaps between the current implementation and the newly
  cataloged provider behavior.
- Do it at the correct seams, not by bolting one-off behavior into tests or the
  combined package.
- Improve black-box realism where downstream consumers can actually observe it.

Execution guardrails for this detour:

- [ ] Before each substantive change, ask: is this a grounds-up canonical
      provider behavior, or am I papering over a consumer-specific test need?
- [ ] Before each provider change, ask: is this being implemented in the right
      seam (`provider.ts`, `service.ts`, `capabilities.ts`, or shared connect
      plane), or am I letting the wrong layer absorb it?
- [ ] Comment new behavior where provider semantics would otherwise be easy to
      misread, especially around connect, pagination, MIME, and attachment
      shape.
- [ ] Self-review after each meaningful tranche, not only at the very end.
- [ ] Write thorough tests for each added seam, including both happy-path and
      adversarial behavior.
- [ ] Keep verifications concrete: assert provider-shaped fields, status codes,
      continuation behavior, and capability gating rather than broad snapshots.
- [ ] Keep checking `microtms-next` usage after major additions to make sure the
      harness remains a viable downstream target.

### Gmail Additions Worth Doing Soon

- [ ] Add Gmail `users.messages.get` format handling for at least
      `minimal`, `full`, `raw`, and `metadata`, including `metadataHeaders[]`
      behavior where it matters.
  Context:
  Gmail references this directly in [gmail.md](./gmail.md) under
  "Message Retrieval And Formats". The current service returns one message shape
  regardless of requested format in
  [packages/gmail/src/service.ts](./packages/gmail/src/service.ts).

- [ ] Add Gmail thread endpoints with provider-shaped list/get semantics rather
      than only storing `threadId` on messages.
  Context:
  Threads are first-class Gmail resources in [gmail.md](./gmail.md), but the
  current HTTP provider only exposes message routes in
  [packages/gmail/src/provider.ts](./packages/gmail/src/provider.ts).

- [ ] Deepen Gmail `messages.list` search realism beyond the current lightweight
      `q` parsing, especially around common operator combinations and edge
      cases that differ from the Gmail UI.
  Context:
  Search semantics are explicitly called out in [gmail.md](./gmail.md) under
  "Search And Filter Semantics". The current query support is intentionally
  narrow in [packages/gmail/src/service.ts](./packages/gmail/src/service.ts).

- [ ] Add Gmail `import` versus `insert` as first-class mailbox-seeding
      operations for the data plane and black-box control plane.
  Context:
  This is one of the cleanest ways to make scenario seeding provider-native.
  See [gmail.md](./gmail.md) under "Mailbox Seeding: Import vs Insert".

- [ ] Add Gmail `watch` and `stop` with realistic watch responses and watch
      expiration state, even if the first implementation keeps notification
      delivery lightweight.
  Context:
  These are official provider seams in [gmail.md](./gmail.md) under
  "Push Notifications" and matter for long-lived black-box mode.

- [ ] Tighten Gmail capability gating around metadata-only or narrower
      read surfaces as the message-format work lands.
  Context:
  Current Gmail scope gating in
  [packages/gmail/src/capabilities.ts](./packages/gmail/src/capabilities.ts)
  covers the broad read/send split, but not the finer shape distinctions called
  out in [gmail.md](./gmail.md).

### Graph Additions Worth Doing Soon

- [ ] Add Graph message `/$value` so consumers can fetch MIME content through
      the official raw-message surface.
  Context:
  Graph documents this in [graph.md](./graph.md) under
  "Message Retrieval And MIME". The current provider exposes JSON message fetch
  but not raw MIME fetch in
  [packages/graph/src/provider.ts](./packages/graph/src/provider.ts).

- [ ] Add `Prefer: outlook.body-content-type=text|html` handling on Graph
      message list/get surfaces.
  Context:
  This is a real observable response-shaping control in [graph.md](./graph.md)
  and is not currently reflected in
  [packages/graph/src/service.ts](./packages/graph/src/service.ts).

- [ ] Add Graph `POST /me/sendMail` with both JSON-message and MIME-oriented
      request handling.
  Context:
  Graph direct send is a first-class provider surface in [graph.md](./graph.md)
  under "Direct Send". Current Graph send behavior is draft-oriented.

- [ ] Add Graph `move` and `copy` for messages so folder-centric mailbox state
      can be tested more realistically.
  Context:
  Graph mailbox realism depends heavily on folder movement. See
  [graph.md](./graph.md) under "Delete And Move".

- [ ] Add Graph large-attachment upload-session support in a way that aligns
      with the black-box large-attachment product goals.
  Context:
  This is the canonical provider path in [graph.md](./graph.md) under
  "Large Attachment Upload Sessions" and is directly aligned with the
  project’s remote black-box attachment requirement.

- [ ] Make Graph delta links more provider-like and opaque, while keeping
      testability and deterministic debugging.
  Context:
  Current delta links are functional but friendlier than real Graph. See
  [packages/graph/src/service.ts](./packages/graph/src/service.ts) and
  [graph.md](./graph.md) under "Delta Query".

- [ ] Add richer Graph attachment types, starting with behavior that
      distinguishes `fileAttachment` from the more special-case
      `itemAttachment` and `referenceAttachment` contracts.
  Context:
  Attachment-type realism is one of the more differentiated Graph-specific
  surfaces in [graph.md](./graph.md).

### High-Value Connect-Plane Additions

- [ ] Add missing-refresh-token and other Gmail offline-grant edge cases as
      first-class, documented provider behaviors instead of only incidental
      knobs.
  Context:
  This is already partly modeled in the shared connect plane, but it deserves
  stronger provider-facing coverage because it mattered operationally to
  `microtms-next`.

- [ ] Add stronger provider-correct denial, expiry, refresh, and capability
      drift tests as the new mail-plane surfaces land.
  Context:
  The shared mechanics already exist in
  [packages/core/src/connect/plane.ts](./packages/core/src/connect/plane.ts),
  so the main work is provider-correct expansion and verification.

### Valuable Later, But Not Blocking This Detour

- [ ] Add Gmail alias/signature realism if and when send-plane identity or
      delegated mailbox behavior becomes an important product ask.
- [ ] Add Graph immutable-ID mode if a real consumer needs move-stable ID
      behavior.
- [ ] Add Graph shared-send semantics if delegated mailbox scenarios become a
      core sales path.
- [ ] Add Graph change-notification subscription and lifecycle realism when the
      product needs a fuller webhook plane, not just delta.

### Explicitly Not Near-Term Priorities

- [ ] Do not prioritize Gmail S/MIME, Gmail delegates, AMP/email markup,
      or broad settings coverage unless the product scope expands materially.
- [ ] Do not prioritize Graph extended properties or broad non-mail Microsoft
      identity features unless a concrete consumer requires them.

## Phase 1: Packaging And Product Surfaces

This is about making the current package split feel complete and intentional.

- [x] Publish and verify real package metadata for `@email-connect/core`, `@email-connect/gmail`, `@email-connect/graph`, and `email-connect`, including repository links, license, keywords, homepage, and files inclusion rules.
- [x] Add a short "which package should I install?" decision table to the README and package READMEs so buyers do not have to infer the split from examples.
- [x] Decide whether each package should have its own README, or whether the root README should generate/install into package-specific docs during publish.
- [x] Add package-level smoke tests that execute against the built `dist` output instead of relying only on workspace source resolution.
- [x] Add a release checklist for breaking changes that affect the provider contract, HTTP shapes, or public SDK helpers.
- [x] Add a versioning policy section so external users know what counts as breaking: continuation-link shapes, control-plane APIs, provider-specific HTTP semantics, example code contracts, and public TypeScript signatures.
- [x] Add publish hygiene checks so package tarballs do not accidentally ship irrelevant workspace files.
- [x] Decide whether the combined `email-connect` package should continue to re-export everything, or whether it should intentionally re-export only the high-value combined surfaces to avoid public API bloat.

## Phase 2: Black-Box Server Productization

The black-box product needs to be strong enough for polyglot teams to treat it
as infrastructure.

- [ ] Add a formal control-plane API contract document that covers mailbox lifecycle, dataset seeding, generation triggers, backend fault injection, clock control, and state inspection.
- [ ] Add a stable machine-readable schema for control-plane payloads so non-TS clients can generate request types.
- [ ] Add a Docker image and a documented single-command startup story for the HTTP server.
- [ ] Add environment-variable configuration for host, port, admin token, seed scenario path, default persistence adapter, and log verbosity.
- [ ] Add health/readiness endpoints so CI and orchestration systems can treat the mock server like a real dependency.
- [ ] Add request logging/tracing options that make provider flow debugging understandable without drowning the user in noise.
- [ ] Add a structured event stream or audit log for black-box runs so consumers can inspect what the engine believed happened.
- [ ] Add the ability to expose only installed provider routes on startup and document that explicitly for Gmail-only and Graph-only deployments.
- [ ] Add negative-path black-box examples that show auth failures, stale cursors, consent denial, and revoked grants through plain HTTP.
- [ ] Add a formal compatibility promise for continuation links, admin routes, and common error payload shapes.
- [ ] Add an explicit large-attachment serving contract for black-box mode, including what payload sizes are expected to work comfortably across machines and what behaviors are guaranteed for attachment metadata and attachment-content routes.
- [ ] Decide and document whether large attachment responses are buffered, streamed, or optionally streamed, and make that behavior deliberate rather than incidental.
- [ ] Add network-facing black-box tests that move realistically large attachments end to end over HTTP, including Gmail-style attachment fetches and Graph `$value` fetches.
- [ ] Add operational guidance for remote deployments where connector and consumer run on different machines, including disk, memory, and network considerations for attachment-heavy scenarios.
- [ ] Add startup configuration for attachment storage mode in black-box deployments, such as in-memory only, file-backed artifact directory, or future persisted backing store.

## Phase 3: White-Box SDK Productization

The SDK should be pleasant enough that a TypeScript consumer reaches for it by
default instead of writing their own helpers around the harness.

- [ ] Add a white-box quickstart that shows the three canonical usage shapes: Gmail-only, Graph-only, and mixed-provider.
- [ ] Add provider-agnostic SDK helpers in `core` for common setup patterns without diluting provider-specific APIs.
- [ ] Add richer typed fixtures/builders for common mailbox patterns so users do not have to manually construct verbose message graphs.
- [ ] Add a scenario builder API that feels more ergonomic than raw object assembly while still serializing cleanly to scenario files.
- [ ] Add first-class clock control helpers for "advance time", "rewind prohibited", "expire token now", and "tick generation schedule".
- [ ] Add richer inspection helpers for inbox snapshot, outbox snapshot, grant state snapshot, and change-log snapshot.
- [ ] Add explicit documentation for how the SDK and HTTP server map to the same canonical engine behavior.
- [ ] Add mixed-provider examples showing one test process orchestrating both Gmail and Graph mailboxes in the same engine instance.
- [ ] Add a small assertions/helper package only if repeated consumer-side patterns justify it; avoid turning this into a test framework.

## Phase 4: Mail Plane Fidelity

This is the highest-leverage area for provider realism.

### Gmail Mail Plane

- [ ] Extend `history.list` realism to cover deletions, label-only changes, and replay of the same message across multiple history pages.
- [ ] Add richer `messages.list` query support for the Gmail query shapes that real consumers use, especially `label:`, `from:`, `to:`, `subject:`, and date filters.
- [ ] Model custom label ids and names more realistically so label-id versus label-name bugs can be caught.
- [ ] Add message state mutations that real clients observe, such as label add/remove, read/unread transitions, archive semantics, and trash/delete semantics where useful.
- [ ] Add delayed visibility and out-of-order history behavior so Gmail consumers can be tested against mail that exists but does not become visible in the neat order they expect.
- [ ] Add duplicate-provider-delivery and replay-heavy scenarios so Gmail consumers can be tested against repeated exposure of the same logical message.
- [ ] Add more realistic pagination behavior for messages and history so continuation handling gets real stress.
- [ ] Add attachment edge cases: missing metadata, unusual MIME types, empty attachments, and large attachment references.
- [ ] Add Gmail attachment delivery behavior for large binaries that is realistic enough to exercise real consumer retry, timeout, and download logic instead of only tiny test fixtures.
- [ ] Add inline-versus-downloadable attachment semantics, especially for HTML mail that references inline content through CID-like behavior.
- [ ] Add richer draft semantics if real consumers rely on draft retrieval/update flows beyond create/send.
- [ ] Add provider-shaped throttling and quota behavior for high-rate read and write operations.

### Graph Mail Plane

- [ ] Extend delta semantics to cover deletion tombstones, mixed change shapes, and repeated entities across pages.
- [ ] Add delayed visibility and out-of-order delta behavior so Graph consumers can be tested against mail that reaches folder views and delta feeds at different times.
- [ ] Add duplicate-provider-delivery and repeated-entity delta scenarios so Graph sync logic can be tested against replay-heavy conditions.
- [ ] Add richer `@odata.nextLink` and `@odata.deltaLink` realism, including opaque tokens with encoded parameters rather than only friendly query shapes.
- [ ] Add more realistic `/me/messages` versus inbox-folder behavior if consumers rely on the distinction.
- [ ] Add richer folder semantics if the product scope grows beyond inbox-only behavior.
- [ ] Add more realistic message flags, categories, and read state for workflows that depend on those fields.
- [ ] Add more edge cases around attachment metadata and `$value` fallback behavior.
- [ ] Add Graph large-attachment scenarios that specifically exercise the `$value` download path over the network with realistic payload sizes.
- [ ] Add inline-versus-downloadable attachment semantics for Graph message bodies and attachment listings.
- [ ] Add throttling, transient Graph service failures, and retry-after semantics that resemble real Graph failure envelopes.
- [ ] Add draft/reply/send edge cases such as deleted source messages, rehydrated drafts, and permission downgrade after draft creation.

### Mixed-Provider Mail Plane

- [ ] Add fairness and contention scenarios where Gmail and Graph mailboxes coexist under different failure, latency, and traffic patterns.
- [ ] Add examples and tests for a product that consumes both providers through the same harness instance.
- [ ] Add parity audits so provider surfaces stay intentionally different where the real providers differ, but conceptually aligned where the harness should feel coherent.
- [ ] Add mixed-provider message-state churn scenarios where Gmail and Graph differ intentionally in ordering, replay, and visibility semantics so consumers can prove they are not overfit to one provider family.

## Phase 5: Connect Plane Maturity

This is the biggest strategic lever because it turns `email-connect` from
"mailbox simulator" into a true mailbox-connect bring-up simulator.

- [ ] Add a provider-side connect subsystem roadmap section to the README so users know this is a first-class part of the product.
- [ ] Add a consent-screen model that can render or auto-approve with provider-specific wording and decisions.
- [ ] Add richer `/authorize` behavior around login hints, account switching, tenant selection, and provider-side account choice.
- [ ] Add provider-side account-picker scenarios where a mailbox other than the hinted account is selected, so consumers can test wrong-account and user-choice flows.
- [ ] Add provider-side `state`, `nonce`, code expiry, code reuse, and PKCE failure realism with explicit white-box controls.
- [ ] Add incremental consent upgrade and downgrade behavior for both providers where applicable.
- [ ] Add consent denial and partial-grant shapes where the real provider can produce them.
- [ ] Add missing-refresh-token and offline-access edge cases for Gmail connect, since those were operationally important in `microtms-next`.
- [ ] Add Graph tenant-path realism beyond `/common` where that matters to real consumers.
- [ ] Add revoke/disconnect semantics that cross-connect into the mail plane so previously working mail operations begin failing the way a real provider integration would.
- [ ] Add scope/capability drift scenarios where read remains valid but send breaks, or attachment reads fail while message listing still works.
- [ ] Add grant-drift scenarios where initial connect succeeds but later provider behavior forces re-consent, refresh begins failing, or capabilities disappear over time.
- [ ] Add revoked-but-not-immediately-obvious states where tokens still exist in consumer storage but provider operations start failing later.
- [ ] Add examples that walk through a full mailbox-connect lifecycle from authorize to mailbox read/write verification.
- [ ] Add adversarial connect examples for consent denial, expired state, wrong redirect URI, stale code, stale refresh token, and provider-side revocation.
- [ ] Add a "shared callback consumer" guidance section for products like `microtms-next` that route multiple OAuth intents through one callback path.

## Phase 6: Generation And Data Plane

This is the part that turns the project into an actual inbox laboratory.

- [ ] Expand the generation model beyond simple profile names into explicit workload models: quiet personal inbox, broker-heavy inbox, carrier-heavy inbox, burst-after-hours inbox, attachment-heavy inbox, reply-chain inbox, and noisy mixed inbox.
- [ ] Add a reusable scenario vocabulary for cadence, business-hours bias, sender reputation mix, thread depth, attachment mix, and retry/follow-up behavior.
- [ ] Add corpus-backed generation with support for shipping curated datasets of subjects, bodies, senders, attachment names, and thread patterns.
- [ ] Add programmatic generation hooks that can derive mail content from a user callback plus a deterministic context object.
- [ ] Add time-window generation, not just count-based generation, so consumers can say "simulate one busy workday" or "simulate a week of off-hours follow-ups."
- [ ] Add inbound-versus-outbound interplay models so the generated mailbox can reflect plausible bidirectional communication instead of isolated inbound events.
- [ ] Add more realistic threading generation, including multi-party threads, late replies, subject drift, and orphaned reply headers.
- [ ] Add sender-identity variation such as aliases, display-name churn, forwarded chains, and malformed-but-common header shapes so consumer parsing logic sees more realistic input.
- [ ] Add attachment generation controls for size bands, MIME families, inline content, and document naming styles.
- [ ] Add first-class large-attachment generation controls for realistic PDFs, spreadsheets, images, archives, and scans so inboxes can model the real cost of attachment-heavy workflows.
- [ ] Add attachment-source strategies so large binaries can come from code generation, fixture corpora, or lightweight backing stores instead of only tiny inline blobs.
- [ ] Add a notion of attachment profiles such as "paperwork-heavy inbox", "image-heavy field inbox", and "scan-heavy backoffice inbox".
- [ ] Add mailbox drift and replay generation so users can simulate old mail resurfacing, duplicate provider delivery, or delayed visibility.
- [ ] Add a persisted data-source layer so scenarios can come from lightweight DB-backed corpora rather than only in-memory arrays.
- [ ] Add seeded reproducibility guarantees and document which knobs are deterministic and which are intentionally stochastic.
- [ ] Add a catalog of ready-to-use generation presets that are good enough to use without custom scripting.
- [ ] Add the ability to generate attachment payloads lazily from deterministic seeds so large artifact scenarios do not always require storing every binary blob in source control.
- [ ] Add realistic attachment metadata generation including filenames, extensions, content types, checksums, and size ranges that resemble operational email traffic.
- [ ] Add first-class workload profiles such as broker desk, carrier dispatch, paperwork-heavy backoffice, and field-photo-heavy operations inboxes so users can start from operational intent instead of only low-level knobs.

## Phase 7: Adversarial And Fault Modeling

This is where the harness becomes truly differentiated.

- [ ] Add a formal fault taxonomy so transient, auth, quota, data-shape, and continuation errors are modeled consistently across providers.
- [ ] Add per-operation retry-after and quota reset behavior.
- [ ] Add failure plans that can target "first N calls", "every third page", "after token refresh", or "only after mailbox state reaches X".
- [ ] Add compound failure scenarios where auth degradation, stale cursor, and throttling interact rather than occurring in isolation.
- [ ] Add provider-realistic payload envelopes for throttling and forbidden responses instead of only status-code simulation.
- [ ] Add fault injection that can be tied to generation state, such as "start returning 429 once inbox volume crosses threshold."
- [ ] Add deterministic chaos recipes so consumers can say "run the Gmail stale-history recipe" or "run the Graph delta-410 recipe" without hand-building backend config.
- [ ] Add mixed-provider chaos scenarios for products that sync multiple mailbox families concurrently.
- [ ] Add attachment-specific chaos modes such as slow downloads, mid-stream disconnects, truncated content, corrupt content-length, and provider-shaped transient download failures.
- [ ] Add black-box fault controls for bandwidth and latency shaping so remote deployments can simulate realistic slow attachment retrieval across machines.
- [ ] Add mailbox-state chaos recipes for delayed visibility, out-of-order arrival, duplicate provider delivery, and state churn so consumers can exercise real synchronization pain points with named presets.

## Phase 8: Persistence And Runtime Modes

Today the engine is great for in-process determinism. A polished product should
also support durable and shareable modes deliberately.

- [ ] Decide on the supported persistence modes: in-memory only, file-backed, and lightweight database-backed.
- [ ] Add a persistence abstraction only if needed for those modes; do not over-abstract until a real second storage backend exists.
- [ ] Add scenario import/export so users can checkpoint and replay real mailbox states between runs.
- [ ] Add server startup modes for "ephemeral test run" versus "long-lived shared mock server".
- [ ] Add reset semantics that are safe and explicit for long-lived black-box deployments.
- [ ] Add data migration/versioning for persisted scenario or mailbox snapshots.
- [ ] Add clear guarantees around whether access tokens, grants, and continuation state survive process restarts in each mode.
- [ ] Add explicit artifact-storage guarantees for large attachments so users know whether binary content is durable, lazily regenerated, or ephemeral in each runtime mode.
- [ ] Add a file-backed artifact store for large attachments so black-box deployments do not have to keep every binary payload in memory.
- [ ] Add cleanup policies and quotas for artifact directories in long-lived black-box deployments.

## Phase 9: Testing Depth And Coverage

This project’s credibility will depend heavily on test quality.

- [ ] Add provider-package-specific test suites that can run as if the package were installed standalone.
- [ ] Add build-from-dist tests that import the built package outputs rather than source paths.
- [ ] Add black-box end-to-end tests that boot the HTTP server and drive full Gmail-only, Graph-only, and mixed-provider flows entirely over HTTP.
- [ ] Add dedicated connect-plane regression suites with real authorize/token/revoke sequences and adversarial variants.
- [ ] Add long-running generation tests that validate deterministic reproducibility across seeds and time windows.
- [ ] Add compatibility tests that verify the same scenario behaves equivalently through the SDK and HTTP surfaces.
- [ ] Add doc-example verification so public example scripts cannot silently rot.
- [ ] Add cross-provider parity tests for shared concepts such as read-only grants, send upgrades, stale continuation recovery, and permission revocation.
- [ ] Add targeted tests for every external-buyer-critical seam: continuation links, token rotation, consent denial, data generation reproducibility, and provider-only package isolation.
- [ ] Add black-box large-attachment soak tests that prove multi-megabyte downloads work repeatedly and correctly over HTTP.
- [ ] Add memory-behavior tests around attachment-heavy scenarios so regressions in buffering/streaming strategy are caught early.
- [ ] Add artifact-store tests that verify persisted large attachments survive restart in the runtime modes that promise durability.

## Phase 10: Documentation And Examples

Strong engineering is not enough. A public product needs excellent explanation.

- [ ] Add a proper getting-started path for each buyer profile: TS SDK user, polyglot HTTP user, Gmail-only buyer, Graph-only buyer, and mixed-provider buyer.
- [ ] Add a "how this maps to real providers" document that calls out intentional simplifications and intentional fidelity areas.
- [ ] Add a scenario cookbook with common recipes such as "busy inbox", "stale history", "stale delta", "consent denied", "offline token missing", and "attachment-heavy thread".
- [ ] Add a cookbook section specifically for networked black-box deployments with large attachments, including realistic PDF-heavy and scan-heavy scenarios.
- [ ] Add a provider matrix doc that clearly shows what Gmail supports today, what Graph supports today, and what is intentionally not modeled yet.
- [ ] Add a "why this exists" positioning document that differentiates `email-connect` from generic mock servers and API stubs.
- [ ] Add dedicated examples for provider-only package installs and mixed-provider composition.
- [ ] Add examples that show black-box control-plane seeding for realistic inbox generation, not only white-box direct insertion.
- [ ] Add more adversarial examples that look like realistic production failures instead of only clean happy paths.
- [ ] Add examples that show remote black-box deployment with large attachments and consumer-side download flows over the network.
- [ ] Add examples that show wrong-account connect flows, delayed mailbox visibility, duplicate delivery, and grant drift so consumers can see how to test realistic integration pain.
- [ ] Add diagrams for the mail plane, connect plane, and package layering.
- [ ] Add one public roadmap section that tells users what is stable now and what is intentionally still evolving.

## Phase 11: Release Engineering And Distribution

This is where "good repo" becomes "real product."

- [ ] Add CI that runs tests, checks, builds, and package smoke verification across the monorepo.
- [ ] Add publish automation for the split packages and the combined package.
- [ ] Add changelog generation and release notes.
- [ ] Add semantic versioning discipline and documented deprecation policy.
- [ ] Add Docker publishing for the black-box server.
- [ ] Add a release validation step that proves package install works from a clean temp project for Gmail-only, Graph-only, and combined installs.
- [ ] Add license clarity for bundled datasets, examples, and any future seeded corpora.
- [ ] Add package-size awareness so provider-only installs stay appropriately smaller than the combined package.

## Phase 12: Consumer Cross-Checks

`microtms-next` should remain a grounded north star, but not the only one.

- [ ] Add a recurring audit where current `microtms-next` usage is mapped against `email-connect` capabilities to ensure the harness remains a viable downstream target.
- [ ] Add explicit cross-check scenarios for Gmail connect bring-up pain points from the historical timeline.
- [ ] Add Graph-specific consumer scenarios for reply-draft/send, attachment fallback, and delta recovery.
- [ ] Add a second reference-consumer perspective, even if synthetic, so the product does not become overfit to one codebase.
- [ ] Add a standing practice of checking recent Gmail and Microsoft Graph reference docs before major provider-fidelity changes land.

## Phase 13: Product And Commercial Polish

This section is about making the offering legible as something people can adopt
and pay for.

- [ ] Decide whether examples, datasets, Docker assets, and scenario catalogs ship in the same repo or in adjacent product repos.
- [ ] Decide how sharply to separate the paid/supportable "product surface" from the broader internal-only experimentation surface.
- [ ] Decide whether provider examples are part of the base packages or a separate examples bundle.
- [ ] Add clear language for what "Gmail-only", "Graph-only", and "both providers" include so packaging maps cleanly to pricing later.
- [ ] Add supportability guidance: what kinds of consumer customizations are encouraged, and what kinds will not be stable.
- [ ] Add migration guides for future major versions once public adoption exists.

## Milestone Definition

The product should not be called "10/10" until all of the following are true:

- [ ] A Gmail-only consumer can install and use the product without pulling in Graph accidentally.
- [ ] A Graph-only consumer can install and use the product without pulling in Gmail accidentally.
- [ ] A mixed-provider consumer can deliberately compose both and get coherent behavior.
- [ ] The black-box server can be used comfortably from a non-JS stack.
- [ ] The white-box SDK can be used comfortably from a JS/TS stack.
- [ ] The connect plane is rich enough to catch real mailbox-connect bring-up failures before production.
- [ ] The generation plane is rich enough to simulate realistic busy and quiet inboxes with meaningful controls.
- [ ] The docs and examples are good enough that a new user can succeed without reading internal source files.
- [ ] The release/distribution story feels like a product, not a dev-only repo.

## Immediate Next Slice

If work resumes soon, the highest-value next tranche is:

- [ ] deepen the connect plane around consent, state/code/token failure realism, and mailbox-grant effects
- [ ] deepen the generation plane so inbox traffic feels configurable and realistic enough to be a major differentiator
- [ ] harden black-box productization with Docker, control-plane docs, and package smoke validation
- [ ] add provider-realistic throttling and richer continuation semantics
- [ ] expand examples and docs so external users can adopt the split packages confidently
- [ ] make large attachment serving a first-class black-box feature with explicit runtime/storage/download behavior
