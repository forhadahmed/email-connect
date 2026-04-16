# @email-connect/graph

`@email-connect/graph` is the Microsoft Graph-only provider package for
`email-connect`.

Use this package when you want:

- Microsoft Graph mail semantics
- Graph-specific white-box SDK helpers
- Graph-specific connect helpers
- a Graph-only black-box HTTP host

## Install

```sh
npm install @email-connect/core @email-connect/graph
```

## When To Use This Package

| Need | Package |
| --- | --- |
| Graph-only product | `@email-connect/core` + `@email-connect/graph` |
| Gmail-only product | `@email-connect/core` + `@email-connect/gmail` |
| Both providers with one install | `email-connect` |

## Example

```ts
import { EmailConnectEngine } from '@email-connect/core';
import { getOutlookGraphClientForMailbox, graphProvider } from '@email-connect/graph';

const engine = new EmailConnectEngine({
  providers: [graphProvider],
});

engine.createMailbox({
  id: 'dispatch',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});

const graph = getOutlookGraphClientForMailbox(engine, 'dispatch');
```

## Surface Policy

This package owns Graph-specific semantics only:

- Graph inbox, delta, message MIME, attachments, drafts, replies, and send flows
- Graph `Prefer: outlook.body-content-type` handling
- Graph move/copy and large-attachment upload sessions
- Graph-specific delegated-mail connect behavior
- Graph-only convenience constructors for the engine and HTTP server

It depends on `@email-connect/core` for the provider-neutral engine and control
plane.

For the combined package overview and the public package-family rules, see the
root [README](../../README.md), [VERSIONING.md](../../VERSIONING.md), and
[RELEASING.md](../../RELEASING.md).
