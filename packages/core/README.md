# @email-connect/core

`@email-connect/core` is the provider-neutral foundation for `email-connect`.

Use this package when you want:

- the canonical mailbox engine
- the control plane
- deterministic generation
- the generic HTTP host
- the ability to compose your own provider set explicitly

## Install

```sh
npm install @email-connect/core
```

Most real consumers pair it with at least one provider package:

```sh
# Gmail only
npm install @email-connect/core @email-connect/gmail

# Graph only
npm install @email-connect/core @email-connect/graph
```

## When To Use This Package

| Need | Package |
| --- | --- |
| Provider-neutral engine and generation only | `@email-connect/core` |
| Gmail-only product | `@email-connect/core` + `@email-connect/gmail` |
| Graph-only product | `@email-connect/core` + `@email-connect/graph` |
| Both providers with the shortest install path | `email-connect` |

## Example

```ts
import { EmailConnectEngine } from '@email-connect/core';
import { gmailProvider, getGmailClientForMailbox } from '@email-connect/gmail';

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

`@email-connect/core` stays provider-neutral on purpose.

If behavior exists only because Gmail or Microsoft Graph differs, it should live
in the provider package rather than in `core`.

For the combined package overview and the public package-family rules, see the
root [README](../../README.md), [VERSIONING.md](../../VERSIONING.md), and
[RELEASING.md](../../RELEASING.md).
