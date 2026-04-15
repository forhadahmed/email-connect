# @email-connect/gmail

`@email-connect/gmail` is the Gmail-only provider package for `email-connect`.

Use this package when you want:

- Gmail mailbox semantics
- Gmail-specific white-box SDK helpers
- Gmail-specific connect helpers
- a Gmail-only black-box HTTP host

## Install

```sh
npm install @email-connect/core @email-connect/gmail
```

## When To Use This Package

| Need | Package |
| --- | --- |
| Gmail-only product | `@email-connect/core` + `@email-connect/gmail` |
| Graph-only product | `@email-connect/core` + `@email-connect/graph` |
| Both providers with one install | `email-connect` |

## Example

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

## Surface Policy

This package owns Gmail-specific semantics only:

- Gmail labels, messages, history, drafts, attachments, and send flows
- Gmail connect semantics such as incremental consent and refresh-token behavior
- Gmail-only convenience constructors for the engine and HTTP server

It depends on `@email-connect/core` for the provider-neutral engine and control
plane.

For the broader product roadmap and packaging policy, see the root
[README](../../README.md), [VERSIONING.md](../../VERSIONING.md), and
[RELEASING.md](../../RELEASING.md).
