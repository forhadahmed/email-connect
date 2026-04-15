# Gmail Reference Catalog

Checked against official Google documentation on 2026-04-14.

This file is a provider-reference catalog for the Gmail side of `email-connect`.
It is not an implementation plan. It is a map of the official surfaces, payload
shapes, and adjacent features that matter when building a realistic Gmail mock
provider and Gmail-connect OAuth simulator.

## How To Use This Catalog

- Treat each section as a candidate product seam for the Gmail package.
- Prefer primary docs that define externally visible behavior over client
  library examples.
- When a feature is listed as "important to mock fidelity", that means a
  consumer like `microtms-next` is likely to observe or depend on it.
- When a feature is listed as "adjacent / future", that means it is not core to
  the current mail-plane or connect-plane implementation but is important to the
  longer-term realism roadmap.

## Canonical Doc Hubs

- Gmail scopes and guide index:
  https://developers.google.com/workspace/gmail/api/auth/scopes
- Gmail REST reference root:
  https://developers.google.com/workspace/gmail/api/reference/rest
- Gmail guides root:
  https://developers.google.com/workspace/gmail/api/guides
- Google OAuth 2.0 web server flow:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Google OpenID Connect:
  https://developers.google.com/identity/openid-connect/openid-connect

## Connect Plane

### OAuth 2.0 Web Server Flow

Primary references:

- https://developers.google.com/identity/protocols/oauth2/web-server

Important reference points:

- The flow is explicitly for confidential web server applications that can
  securely store client credentials and maintain state.
- The documented `/authorize` style flow centers on redirecting the user to
  Google, receiving an authorization code, and exchanging it for access and
  refresh tokens.
- Google recommends incremental authorization rather than requesting every scope
  up front.
- `state` is explicitly recommended to reduce CSRF risk.
- `access_type=offline` is the documented switch for receiving a refresh token.
- `include_granted_scopes=true` is the documented incremental-consent control.
- `prompt=consent` is documented for forcing a consent screen.
- Refresh token responses can include `refresh_token_expires_in` for time-based
  access.
- Revocation uses `https://oauth2.googleapis.com/revoke`.

Reference details worth preserving in the mock:

- `access_type=offline` and incremental consent are first-class behaviors, not
  custom extensions.
- Revoking an access token can revoke the corresponding refresh token.
- Google explicitly notes that revocation can take some time to fully take
  effect.

Specific references:

- Authorization flow overview:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Incremental authorization example:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Token refresh request shape:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Revocation request shape:
  https://developers.google.com/identity/protocols/oauth2/web-server

### OpenID Connect And UserInfo

Primary references:

- https://developers.google.com/identity/openid-connect/openid-connect

Important reference points:

- Google publishes a discovery document at:
  `https://accounts.google.com/.well-known/openid-configuration`
- The discovery document includes:
  - `authorization_endpoint`
  - `token_endpoint`
  - `userinfo_endpoint`
  - `revocation_endpoint`
  - `jwks_uri`
- The documented `userinfo_endpoint` is:
  `https://openidconnect.googleapis.com/v1/userinfo`
- Claims called out in the discovery and OIDC docs include:
  - `sub`
  - `email`
  - `email_verified`
  - `name`
  - `given_name`
  - `family_name`
  - `picture`
- `hd` is a UI optimization hint for hosted domains and must not be treated as
  authorization by itself; the returned ID token `hd` claim is the trustworthy
  value.

Important to mock fidelity:

- UserInfo response shape and discovery document fields.
- Optional `hd` behavior and returned claim shape.
- Hosted-domain hints and claim validation are relevant for connect-plane
  consumers that route mailboxes or tenants by domain.

### OAuth Scopes Relevant To Mailbox Connect

Primary references:

- https://developers.google.com/workspace/gmail/api/auth/scopes

Important Gmail scopes:

- `https://www.googleapis.com/auth/gmail.readonly`
  - view messages and settings
- `https://www.googleapis.com/auth/gmail.compose`
  - manage drafts and send email
- `https://www.googleapis.com/auth/gmail.send`
  - send email only
- `https://www.googleapis.com/auth/gmail.modify`
  - read, compose, send, and label-change without permanent delete
- `https://www.googleapis.com/auth/gmail.metadata`
  - headers and labels but not body
- `https://mail.google.com/`
  - full Gmail access including permanent delete
- `https://www.googleapis.com/auth/gmail.insert`
  - add emails into the mailbox

Important to mock fidelity:

- Gmail has meaningful distinctions between metadata-only, readonly, modify,
  compose, send-only, and full-mail scopes.
- `gmail.send` is narrower than compose or modify.
- `gmail.metadata` can support header-and-label workflows without body access.
- `mail.google.com/` is meaningfully stronger than `gmail.modify`.

## Mailbox Read Plane

### User Profile Bootstrap

Primary reference:

- `users.getProfile`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile

HTTP surface:

- `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/profile`

Documented response fields:

- `emailAddress`
- `messagesTotal`
- `threadsTotal`
- `historyId`

Important to mock fidelity:

- `historyId` is the bootstrap point for history-based sync.
- `messagesTotal` and `threadsTotal` are useful for realistic mailbox summaries.

### Message Listing

Primary references:

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/list-messages
- REST resource:
  https://developers.google.com/gmail/api/reference/rest/v1/users.messages

Important query parameters documented in the guide:

- `maxResults`
  - defaults to `100`, maximum `500`
- `pageToken`
- `q`
- `labelIds`
- `includeSpamTrash`

Important to mock fidelity:

- Pagination semantics matter.
- `q` filtering is a core user-facing feature.
- `labelIds` is a separate server-side filter dimension.
- `includeSpamTrash` can change list behavior materially.

### Search And Filter Semantics

Primary reference:

- https://developers.google.com/workspace/gmail/api/guides/filtering

Important documented behavior:

- `messages.list` and `threads.list` accept the `q` parameter.
- Gmail API supports most of the Gmail web UI advanced search syntax, but not
  all of it.
- The API does not support thread-wide searches the way the Gmail UI does.
- The Gmail UI performs alias expansion; the API does not.
- Date searches are interpreted in PST when specified as dates, with epoch
  seconds recommended for accurate timezone-aware filtering.

Important to mock fidelity:

- Alias expansion differences are real and observable.
- Thread-wide search mismatch is explicitly documented.
- Search semantics are a high-value realism area for black-box consumers.

### Message Retrieval And Formats

Primary reference:

- `users.messages.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get

HTTP surface:

- `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/messages/{id}`

Important documented query parameters:

- `format`
- `metadataHeaders[]` when `format=METADATA`

Important related enum reference:

- `Format`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format

Documented enum values:

- `minimal`
- `full`
- `raw`
- `metadata`

Important to mock fidelity:

- The method is explicitly format-sensitive.
- Metadata-only reads are part of the public contract.
- Message IDs can originate from list results, insert, or import flows.

Related resource shape:

- `users.messages` REST resource:
  https://developers.google.com/gmail/api/reference/rest/v1/users.messages

Important message fields called out in the resource:

- `id`
- `threadId`
- `labelIds`
- `snippet`
- `historyId`
- `internalDate`
- `payload`
- `sizeEstimate`
- `raw`

Important to mock fidelity:

- Gmail exposes both structured MIME payloads and `raw` base64url content.
- `internalDate` and `historyId` are both important behavioral fields.
- `payload.parts[]` is the right seam for attachment and inline-part realism.

### Threads

Primary references:

- `users.threads.list`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list
- `users.threads.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get
- Guide:
  https://developers.google.com/workspace/gmail/api/guides/threads

Important documented behavior:

- Threads are a first-class API resource.
- Thread detail retrieval supports message format selection.
- Thread listing and message listing are separate surfaces.

Important to mock fidelity:

- Thread IDs are canonical Gmail primitives, not derived client conveniences.
- Thread retrieval is important for UI-like consumers and deep-thread test
  cases.

### Labels

Primary references:

- `users.labels.list`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list
- Manage labels guide:
  https://developers.google.com/workspace/gmail/api/guides/labels

Important documented behavior:

- `users.labels.list` returns label resources with:
  - `id`
  - `name`
  - `messageListVisibility`
  - `labelListVisibility`
  - `type`
- Additional label details are available through `labels.get`.

Important to mock fidelity:

- Label ID and label name are not interchangeable conceptually.
- Visibility metadata matters to realistic label catalogs.
- Custom labels and system labels are part of the public shape.

### Message Mutation

Primary references:

- `users.messages.modify`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify
- `users.threads.modify`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify

Important documented behavior:

- Gmail exposes label mutation as first-class message and thread operations.
- Label mutation is a core part of read-state and mailbox-state simulation,
  even when the provider does not expose IMAP-like folder movement.

Important to mock fidelity:

- Label changes are part of `history.list` change streams.
- Message-level and thread-level mutation are separate behaviors.

### Mailbox Seeding: Import vs Insert

Primary references:

- `users.messages.import`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/import
- `users.messages.insert`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/insert
- `InternalDateSource`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/InternalDateSource

Important documented behavior:

- `users.messages.import`
  - imports mail with standard email delivery scanning and classification
  - supports `internalDateSource`
  - supports `neverMarkSpam`
  - supports `processForCalendar`
  - supports `deleted`
  - maximum message size is documented as `150MB`
- `users.messages.insert`
  - inserts mail directly, similar to IMAP APPEND
  - bypasses most scanning and classification
  - supports `internalDateSource`
  - supports `deleted`

Important documented enum values:

- `receivedTime`
  - internal date set to current time when Gmail receives the message
- `dateHeader`
  - internal date based on the `Date` header when valid

Important to mock fidelity:

- Gmail explicitly distinguishes seeded-import realism from seeded-append
  realism.
- `import` and `insert` are valuable seams for fixture ingestion and synthetic
  mailbox generation.
- `internalDateSource` matters for ordering and backfill realism.

## Attachments And Message Bodies

### Attachment Retrieval

Primary reference:

- `users.messages.attachments.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get

HTTP surface:

- `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/messages/{messageId}/attachments/{id}`

Documented response shape:

- returns `MessagePartBody`

Important to mock fidelity:

- Gmail attachment fetch is not a separate blob service. It is a message-part
  body fetch under the message resource tree.
- Attachment lookup is anchored by both `messageId` and `attachment id`.

### Upload And Send Surfaces

Primary references:

- Upload guide:
  https://developers.google.com/workspace/gmail/api/guides/uploads
- `users.messages.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- `users.drafts.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send

Important documented behavior:

- Gmail supports:
  - `uploadType=media`
  - `uploadType=multipart`
  - `uploadType=resumable`
- Uploads use `/upload/gmail/v1/...` URIs.
- `messages.send` supports both:
  - upload URI for media upload
  - metadata URI for metadata-only requests
- Simple upload example uses `Content-Type: message/rfc822`.
- Multipart upload uses `multipart/related`.
- Resumable upload is specifically recommended for larger or more reliable
  transfers.

Important to mock fidelity:

- Gmail’s send surface is both JSON-like and raw MIME / media-upload shaped.
- Large-payload realism should consider resumable upload behavior even if v1 of
  the mock does not fully implement it.
- Gmail attachment realism is tightly linked to MIME-body realism, not just blob
  serving.

### Drafts

Primary references:

- Drafts guide:
  https://developers.google.com/workspace/gmail/api/guides/drafts
- `users.drafts.create`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- `users.drafts.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/get
- `users.drafts.list`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/list
- `users.drafts.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send

Important documented behavior:

- Drafts are first-class resources, distinct from sent messages.
- `users.drafts.send` returns a `Message`, not a `Draft`.
- Gmail documents drafts as containers around a `Message`.

Important to mock fidelity:

- Draft identity and message identity should not be collapsed.
- Draft send and direct send are distinct surfaces.

## Change Tracking And Notifications

### History API

Primary references:

- Sync guide:
  https://developers.google.com/workspace/gmail/api/guides/sync
- `users.history.list`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list

HTTP surface:

- `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/history`

Documented change types:

- `MessageAdded`
- `MessageDeleted`
- `LabelAdded`
- `LabelRemoved`

Important documented behavior:

- History is returned in chronological order with increasing `historyId`.
- `startHistoryId` is required.
- History IDs increase chronologically but are not contiguous.
- `pageToken` and `maxResults` are supported, with max `500`.
- `historyTypes[]` can filter change types.
- An invalid or out-of-date `startHistoryId` typically returns HTTP `404`.
- On `404`, clients should perform a full sync.
- A `historyId` is typically valid for at least a week, but may be valid for
  only a few hours in rare cases.

Important to mock fidelity:

- Cursor expiry and full-sync fallback are mandatory realism seams.
- History feeds include more than new-message events.
- Non-contiguous `historyId` values are explicitly documented.

### Push Notifications

Primary references:

- Push guide:
  https://developers.google.com/workspace/gmail/api/guides/push
- `users.watch`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
- `users.stop`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop

Important documented behavior:

- A successful `watch` response includes:
  - `historyId`
  - `expiration`
- A successful `watch` call immediately causes a notification to be sent.
- Watches must be renewed at least once every 7 days; Google recommends once
  per day.
- Notification payloads are delivered through Cloud Pub/Sub, with base64url
  data containing:
  - `emailAddress`
  - `historyId`
- `users.stop` stops push notifications and returns an empty JSON object.

Important to mock fidelity:

- `watch` / `stop` are part of the provider contract even if a consumer does
  not use Pub/Sub in production.
- Expiration and renewal behavior matter for long-lived remote black-box mode.
- The notification payload is intentionally thin; clients are expected to use
  history afterward.

## Send, Compose, And Reply Surfaces

### Direct Send

Primary reference:

- `users.messages.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send

Important documented behavior:

- Supports upload and metadata URIs.
- Returns a `Message`.
- Accepts multiple mail scopes including `gmail.send`, `gmail.compose`, and
  `gmail.modify`.

### Draft Send

Primary reference:

- `users.drafts.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send

Important documented behavior:

- Supports upload and metadata URIs.
- Request body is a `Draft`.
- Response body is a `Message`.

### Aliases And Signatures

Primary reference:

- https://developers.google.com/workspace/gmail/api/guides/alias_and_signature_settings

Important documented behavior:

- Send-as aliases are first-class Gmail settings.
- Some aliases require verification and can be returned with
  `VerificationStatus=pending`.
- `settings.sendAs.verify` can resend verification.
- External aliases can use remote SMTP MSA configuration via `smtpMsa`.
- Signatures are managed per alias.

Important to mock fidelity:

- Alias verification and per-alias signatures are future-worthy connect-plane
  and send-plane realism features.

## Adjacent And Future Gmail Features

These are not the current core of `email-connect`, but they are relevant to a
serious Gmail harness and should stay on the radar.

### Filters

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/filter_settings

Why it matters:

- Filters can alter delivery outcomes and label application in ways that change
  mailbox state before the consumer reads it.

### S/MIME

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/smime_certs

Why it matters:

- Certificate and encryption realism becomes important if the harness evolves
  toward more enterprise-grade mailbox behaviors.

### Delegates

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/delegate_settings

Why it matters:

- Shared mailbox or delegate scenarios can alter connect-plane assumptions and
  sending identity behavior.

### Batch Requests

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/batch

Why it matters:

- Batch semantics affect scale realism and large mailbox sync behavior.

### Performance Tips

- Guide:
  https://developers.google.com/workspace/gmail/api/guides/performance

Why it matters:

- Provides official guidance for efficient list/get usage and helps shape
  realistic provider-side constraints.

### Inbox Feed And Sender-Facing Surfaces

Useful future references:

- Gmail inbox feed:
  https://developers.google.com/workspace/gmail/gmail_inbox_feed
- AMP for Gmail:
  https://developers.google.com/workspace/gmail/ampemail/
- Email markup:
  https://developers.google.com/workspace/gmail/markup/

Why they matter:

- Not core mailbox sync features, but useful if the product later wants to
  simulate richer message-display or structured-message behaviors.

## Gmail-Specific Mocking Notes

The official references above suggest a few Gmail-specific fidelity rules:

- Search results should not assume Gmail UI equivalence.
- History feeds should model:
  - additions
  - deletions
  - label changes
  - cursor expiry
  - non-contiguous history IDs
- Push notifications should be thin and history-driven.
- Attachment fetching is part-based and message-anchored.
- Raw MIME send and upload-mode differences are part of the public contract.
- Scope gating should preserve the distinctions among:
  - metadata-only
  - readonly
  - modify
  - compose
  - send-only
  - full-mail access

## Shortlist For `email-connect`

If this catalog is used to guide the Gmail package, the most important reference
surfaces to keep close at hand are:

- OAuth web server flow:
  https://developers.google.com/identity/protocols/oauth2/web-server
- OpenID Connect and discovery:
  https://developers.google.com/identity/openid-connect/openid-connect
- Gmail scopes:
  https://developers.google.com/workspace/gmail/api/auth/scopes
- `users.getProfile`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
- `users.messages.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
- `users.messages.attachments.get`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get
- `users.history.list`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Sync guide:
  https://developers.google.com/workspace/gmail/api/guides/sync
- Push guide:
  https://developers.google.com/workspace/gmail/api/guides/push
- `users.watch`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
- `users.stop`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop
- `users.messages.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- `users.drafts.send`:
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send
- Upload guide:
  https://developers.google.com/workspace/gmail/api/guides/uploads
