# Examples

These examples show both first-class surfaces of `email-connect`:

- white-box SDK scripts for in-process tests
- black-box HTTP scripts for polyglot or over-the-wire integration tests

Each file is a plain runnable script with `node:assert` assertions instead of a
test-framework wrapper. They compile under `npm run check`, but they do not run
as part of the default `npm test` command.

## White-Box SDK Matrix

- Gmail basic receive: [basic-receive-gmail.example.ts](./basic-receive-gmail.example.ts)
- Gmail advanced receive: [advanced-receive-gmail.example.ts](./advanced-receive-gmail.example.ts)
- Gmail basic send: [basic-send-gmail.example.ts](./basic-send-gmail.example.ts)
- Gmail advanced send: [advanced-send-gmail.example.ts](./advanced-send-gmail.example.ts)
- Gmail basic connect: [basic-connect-gmail.example.ts](./basic-connect-gmail.example.ts)
- Gmail advanced connect: [advanced-connect-gmail.example.ts](./advanced-connect-gmail.example.ts)
- Gmail adversarial receive: [adversarial-gmail-history-reset.example.ts](./adversarial-gmail-history-reset.example.ts)
- Graph basic receive: [basic-receive-graph.example.ts](./basic-receive-graph.example.ts)
- Graph advanced receive: [advanced-receive-graph.example.ts](./advanced-receive-graph.example.ts)
- Graph basic send: [basic-send-graph.example.ts](./basic-send-graph.example.ts)
- Graph advanced send: [advanced-send-graph.example.ts](./advanced-send-graph.example.ts)
- Graph basic connect: [basic-connect-graph.example.ts](./basic-connect-graph.example.ts)
- Graph advanced connect: [advanced-connect-graph.example.ts](./advanced-connect-graph.example.ts)
- Graph adversarial receive: [adversarial-graph-stale-delta.example.ts](./adversarial-graph-stale-delta.example.ts)
- Generated busy inbox: [generated-busy-inbox.example.ts](./generated-busy-inbox.example.ts)

## Black-Box HTTP Matrix

- Gmail basic connect over HTTP: [basic-connect-gmail-http.example.ts](./basic-connect-gmail-http.example.ts)
- Gmail advanced connect over HTTP: [advanced-connect-gmail-http.example.ts](./advanced-connect-gmail-http.example.ts)
- Graph basic connect over HTTP: [basic-connect-graph-http.example.ts](./basic-connect-graph-http.example.ts)

## Reading The Examples

- "Outside world" means a carrier, broker, or shipper causing inbound mail to
  appear. In white-box tests, that is usually modeled by calling
  `engine.appendMessage(...)`.
- In black-box examples, "outside world" usually means hitting the admin
  control plane to seed mailbox state before the provider-facing flow begins.
- "Inside world" means the system under test using Gmail-like or Graph-like
  provider surfaces to discover, open, and process mail.
- TX examples assert against `engine.listOutbox(...)`, because the outbox is the
  canonical record of what the application tried to send through the provider.
- Connect examples assert against the issued grant, the redirect/code exchange
  lifecycle, and the resulting read/send behavior after consent.
- The advanced examples focus on richer mailbox semantics such as threading,
  attachments, history, delta checkpoints, repeated consent, refresh-token
  rotation, mailbox-permission upgrades, and Google incremental consent rather
  than only "more rows."
