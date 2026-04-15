# Microsoft Graph Reference Catalog

Checked against official Microsoft documentation on 2026-04-14.

This file is a provider-reference catalog for the Microsoft Graph side of
`email-connect`. It focuses on the Outlook mail and Microsoft identity platform
surfaces that matter when building a realistic Graph mock provider and
Graph-connect OAuth simulator.

## How To Use This Catalog

- Treat each section as a candidate product seam for the Graph package.
- Prefer REST and identity-platform references over SDK convenience material.
- When a feature is listed as "important to mock fidelity", it is something a
  black-box consumer is likely to observe or depend on directly.
- When a feature is listed as "adjacent / future", it is useful for roadmap
  depth even if it is not part of the current implementation.

## Canonical Doc Hubs

- Microsoft identity platform auth code flow:
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft identity platform OIDC scopes:
  https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc
- Microsoft identity platform UserInfo endpoint:
  https://learn.microsoft.com/en-us/entra/identity-platform/userinfo
- Microsoft Graph permissions reference:
  https://learn.microsoft.com/en-us/graph/permissions-reference
- Microsoft Graph message delta:
  https://learn.microsoft.com/en-us/graph/delta-query-messages
- Microsoft Graph change notifications:
  https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks

## Connect Plane

### OAuth 2.0 Authorization Code Flow

Primary reference:

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

Important documented behavior:

- Authorization endpoint shape:
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
- Token endpoint shape:
  `POST /{tenant}/oauth2/v2.0/token`
- `tenant` can be `common`, `organizations`, `consumers`, or a tenant ID.
- Example authorize parameters explicitly include:
  - `client_id`
  - `response_type=code`
  - `redirect_uri`
  - `response_mode`
  - `scope`
  - `state`
  - `code_challenge`
  - `code_challenge_method=S256`
- `scope` on `/authorize` can cover multiple resources.
- Successful redirect returns `code` and optionally echoes `state`.
- Authorization code lifetime is documented as typically about 1 minute.
- Error redirects return:
  - `error`
  - `error_description`
- Documented auth endpoint errors include:
  - `invalid_request`
  - `unauthorized_client`
  - `access_denied`
  - `unsupported_response_type`
  - `server_error`
  - `temporarily_unavailable`

Important to mock fidelity:

- Tenant routing is a first-class part of Microsoft’s surface.
- PKCE is documented directly on the auth code flow page and should be modeled.
- Error redirects and user-denied-consent behavior are part of the canonical
  connect plane.

### Token Exchange And Refresh

Primary reference:

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

Important documented behavior:

- Token redemption request includes:
  - `client_id`
  - `scope` (optional at token redemption)
  - `code`
  - `redirect_uri`
  - `grant_type=authorization_code`
  - `code_verifier` when PKCE is used
  - `client_secret` for confidential web apps
- Refresh flow uses:
  - `grant_type=refresh_token`
  - `refresh_token`
  - `scope`
  - `client_secret` for confidential web apps
- Refresh tokens are long-lived for web/native apps but can expire, be revoked,
  or lose privileges.
- Refresh tokens can be rotated. Microsoft explicitly says clients must discard
  the old refresh token when a new one is issued.
- SPA-registered redirect URIs have special 24-hour refresh-token behavior.

Important to mock fidelity:

- Refresh-token rotation should be observable.
- Refresh can fail because the token is revoked or lacks sufficient privileges.
- Confidential-web-app vs SPA behavior should stay distinct.

### OIDC Scopes And UserInfo

Primary references:

- OIDC scopes:
  https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc
- UserInfo:
  https://learn.microsoft.com/en-us/entra/identity-platform/userinfo

Important documented behavior:

- OpenID Connect scopes are:
  - `openid`
  - `email`
  - `profile`
  - `offline_access`
- `openid` is required for OIDC sign-in and gives access to UserInfo.
- `email` is optional and the claim may be absent if the account has no email
  claim available.
- `profile` enriches ID token or UserInfo claims.
- `offline_access` must be explicitly requested on the v2.0 endpoint to receive
  refresh tokens.
- Microsoft says the access token used with UserInfo should be treated as
  opaque.
- Microsoft recommends using the ID token for user info when possible, but the
  UserInfo endpoint is still part of the supported contract.
- UserInfo is served at:
  `GET or POST /oidc/userinfo` on `graph.microsoft.com`

Documented UserInfo response fields include:

- `sub`
- `name`
- `family_name`
- `given_name`
- `picture`
- `email`

Important to mock fidelity:

- `offline_access` behavior should be explicit.
- UserInfo and ID token claims are related but not identical product choices.
- Opaque-token guidance is worth preserving in black-box docs and examples.

### Mail Permissions

Primary reference:

- https://learn.microsoft.com/en-us/graph/permissions-reference

Important documented mail permissions:

- `Mail.Read`
  - read user mail
- `Mail.ReadBasic`
  - excludes body, previewBody, attachments, and extended properties
- `Mail.ReadWrite`
  - create, read, update, delete mail, but not send
- `Mail.Send`
  - send mail without requiring read/write
- `Mail.Read.Shared`
- `Mail.ReadWrite.Shared`
- `Mail.Send.Shared`

Important documented nuance:

- `Mail.ReadWrite` does not include send permission.
- `Mail.Send` can save a copy to Sent Items even without `Mail.ReadWrite`.

Important to mock fidelity:

- Read vs write vs send capability boundaries are important and observable.
- `Mail.ReadBasic` is a useful future realism seam for metadata-only consumers.
- Shared-mail permissions are a future worth keeping in sight.

## Mailbox Read Plane

### Message Resource Shape

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0

Important documented fields and relationships:

- `id`
- `conversationId`
- `conversationIndex`
- `changeKey`
- `internetMessageId`
- `internetMessageHeaders`
- `body`
- `bodyPreview`
- `hasAttachments`
- `isDraft`
- `isRead`
- `from`
- `sender`
- `toRecipients`
- `ccRecipients`
- `bccRecipients`
- relationship: `attachments`

Important to mock fidelity:

- Graph treats conversation identity as a first-class message property.
- `internetMessageHeaders` and `internetMessageId` are part of the public shape.
- `changeKey` is worth modeling for update realism.

### Message Listing

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0

HTTP surfaces:

- `GET /me/messages`
- `GET /users/{id | userPrincipalName}/messages`
- `GET /me/mailFolders/{id}/messages`
- `GET /users/{id | userPrincipalName}/mailFolders/{id}/messages`

Important documented behavior:

- Supports OData query parameters.
- Supports `Prefer: outlook.body-content-type=text|html`.
- Combined `$filter` and `$orderby` have explicit constraints.
- Violating those constraints can produce `InefficientFilter`.

Important to mock fidelity:

- Folder-scoped list and mailbox-wide list are distinct public shapes.
- `Prefer: outlook.body-content-type` is a real response-shaping control.
- Query behavior is a significant realism seam for Graph consumers.

### Message Retrieval And MIME

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0

HTTP surfaces:

- `GET /me/messages/{id}`
- `GET /users/{id | userPrincipalName}/messages/{id}`
- `GET /me/messages/{id}/$value`
- folder-scoped variants

Important documented behavior:

- `$value` returns MIME content rather than a message resource.
- `Prefer: outlook.body-content-type=text|html` shapes `body` and `uniqueBody`.

Important to mock fidelity:

- Graph exposes both JSON resource reads and raw MIME reads.
- Body-format preference is a meaningful surface difference from Gmail.

### Folders

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/resources/mailfolder?view=graph-rest-1.0

Important documented behavior:

- Mail folders are first-class resources with well-known folder names.
- The resource includes hidden and operational folders such as:
  - `sentitems`
  - `deleteditems`
  - `searchfolders`
  - `syncissues`
  - `serverfailures`
  - `recoverableitemsdeletions`
- You can create messages directly in a folder.

Important to mock fidelity:

- Graph’s model is folder-centric, unlike Gmail’s label-centric model.
- Well-known folder names matter for move/copy and targeted list calls.

## Attachments And Large Payloads

### Attachment Listing

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0

HTTP surface:

- `GET /me/messages/{id}/attachments`
- folder-scoped variants

Important documented behavior:

- Returns a collection of `attachment` objects.
- Supports standard OData query parameters.

### Attachment Retrieval

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0

HTTP surfaces:

- `GET /me/messages/{id}/attachments/{id}`
- `GET /me/messages/{id}/attachments/{id}/$value`

Important documented behavior:

- The attachment resource can be fetched by metadata route.
- For file or Outlook item attachments, raw contents can be fetched with
  `/$value`.

Important to mock fidelity:

- Metadata fetch and raw-byte fetch are distinct surfaces.
- Graph attachment downloads are explicit and route-based rather than implicit
  part-body fetches.

### Attachment Types

Primary references:

- fileAttachment:
  https://learn.microsoft.com/en-us/graph/api/resources/fileattachment?view=graph-rest-1.0
- itemAttachment:
  https://learn.microsoft.com/en-us/graph/api/resources/itemattachment?view=graph-rest-1.0
- referenceAttachment:
  https://learn.microsoft.com/en-us/graph/api/resources/referenceattachment?view=graph-rest-1.0

Important documented behavior:

- `fileAttachment`
  - uses `contentBytes`
  - has `contentType`, `name`, `size`, `isInline`, `contentId`
- `itemAttachment`
  - represents an attached message, event, or contact
  - exposes an `item` relationship
- `referenceAttachment`
  - represents a reference attachment
  - `size` describes the stored metadata size, not the remote file size

Important to mock fidelity:

- Inline vs non-inline attachments are first-class fields.
- Nested attached items are a provider-native concept.
- Reference attachments are not equivalent to file attachments.

### Large Attachment Upload Sessions

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/attachment-createuploadsession?view=graph-rest-1.0
- Large attachment guide:
  https://learn.microsoft.com/en-us/graph/outlook-large-attachments

HTTP surface:

- `POST /me/messages/{id}/attachments/createUploadSession`

Important documented behavior:

- Returns `201 Created` and an `uploadSession`.
- The returned `uploadUrl` is opaque and should not be customized.
- The upload session contains `nextExpectedRanges`.
- Upload bytes must be sent in order.
- Microsoft documents separate handling for attachments smaller than `3 MB` and
  for files between `3 MB` and `150 MB`.
- Microsoft recommends fetching large attachments through attachment routes
  rather than relying on inline `contentBytes`.

Important to mock fidelity:

- Graph has an official large-attachment contract, not just inline `contentBytes`.
- Opaque upload-session URLs and ordered ranges are important if `email-connect`
  wants to stand out for large-payload realism in black-box mode.

## Change Tracking And Notifications

### Delta Query

Primary reference:

- https://learn.microsoft.com/en-us/graph/delta-query-messages

HTTP surface:

- `GET /me/mailFolders/{id}/messages/delta`

Important documented behavior:

- Delta returns either:
  - `@odata.nextLink`
  - `@odata.deltaLink`
- These links contain state tokens and are opaque to the client.
- Clients are expected to copy and reuse the returned URLs directly.
- `changeType=created|updated|deleted` is supported.
- `Prefer: odata.maxpagesize={x}` is supported.
- Initial sync returns the full contents of the folder.
- Later rounds return only changes.
- Deleted items appear with `@removed`.

Important to mock fidelity:

- Opaque next/delta links are core Graph behavior.
- Deletions and updates are part of the normal delta contract.
- Folder scope is fundamental.

### Change Notifications

Primary references:

- Webhooks:
  https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- Create subscription:
  https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0
- Lifecycle events:
  https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events

Important documented behavior:

- Subscription creation uses `POST /subscriptions`.
- Mail resource examples include:
  - `resource: "/me/mailfolders('inbox')/messages"`
- Microsoft Graph validates the notification URL by sending a validation token
  that the client must echo back in plain text.
- Subscriptions can include `lifecycleNotificationUrl`.
- Supported lifecycle events include:
  - `reauthorizationRequired`
  - `subscriptionRemoved`
  - `missed notifications`
- If an access token used for notifications expires, Microsoft Graph retries
  delivery for up to 4 hours.

Important to mock fidelity:

- Validation-token handshake is part of the public contract.
- Lifecycle notifications are a valuable advanced realism seam.
- Retry behavior after access-token expiry is worth simulating in long-lived
  black-box mode.

### Immutable IDs

Primary reference:

- https://learn.microsoft.com/en-us/graph/outlook-immutable-id

Important documented behavior:

- Clients opt in with:
  `Prefer: IdType="ImmutableId"`
- Immutable IDs do not change when an item moves folders in the same mailbox.
- Immutable IDs do change if items move to archive or are exported and
  re-imported.
- Immutable IDs are supported for:
  - messages
  - attachments
  - events
  - eventMessages
  - contacts
  - outlookTasks
- Immutable IDs can be requested in change notifications and delta queries.
- Getting a sent copy by immutable ID may not succeed immediately after send.

Important to mock fidelity:

- ID-mode choice is an official behavior switch, not a client convention.
- Send-after-draft and move semantics are affected by ID mode.

## Send, Draft, And Mutation Surfaces

### Direct Send

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0

HTTP surfaces:

- `POST /me/sendMail`
- `POST /users/{id | userPrincipalName}/sendMail`

Important documented behavior:

- Supports either:
  - `application/json`
  - `text/plain` for MIME content
- JSON request body includes:
  - `message`
  - optional `saveToSentItems`
- MIME mode expects base64-encoded MIME content in the request body.

Important to mock fidelity:

- Graph supports direct send without draft creation.
- MIME send is a first-class official path.
- `saveToSentItems` behavior is configurable.

### Draft Reply

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0

HTTP surfaces:

- `POST /me/messages/{id}/createReply`
- folder-scoped variants

Important documented behavior:

- Supports `application/json` and `text/plain` MIME content types.
- Returns a draft reply rather than immediately sending.

### Send Existing Draft

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0

HTTP surface:

- `POST /me/messages/{id}/send`

Important documented behavior:

- Requires no request body.
- Returns `202 Accepted` with no response body.

### Update Draft Or Message Metadata

Primary reference:

- https://learn.microsoft.com/en-us/graph/api/message-update?view=graph-rest-1.0

Important documented behavior:

- Several fields are updatable only when `isDraft=true`, including:
  - recipients
  - body
- Non-draft metadata like categories or flags have their own semantics.

Important to mock fidelity:

- Draft mutability is a real Graph behavior boundary.

### Delete And Move

Primary references:

- Delete:
  https://learn.microsoft.com/en-us/graph/api/message-delete?view=graph-rest-1.0
- Move:
  https://learn.microsoft.com/en-us/graph/api/message-move?view=graph-rest-1.0
- Copy:
  https://learn.microsoft.com/en-us/graph/api/message-copy?view=graph-rest-1.0

Important documented behavior:

- Delete returns `204 No Content`.
- Move takes `destinationId`, which can be a folder ID or well-known folder
  name.
- Move returns `201 Created` and the moved message resource.

Important to mock fidelity:

- Graph mailbox-state realism often depends on folder movement, not label
  mutation.

## Adjacent And Future Graph Features

These are not the current core of `email-connect`, but they are relevant to a
serious Graph harness and should stay on the radar.

### Forward

- `message.createForward`:
  https://learn.microsoft.com/en-us/graph/api/message-createforward?view=graph-rest-1.0

Why it matters:

- Forward flows often diverge from reply flows in body handling and attachment
  carryover.

### Send From Another User

- Guide:
  https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user

Why it matters:

- Shared and delegated mailbox behavior is provider-documented, not app-local.
- The guide clarifies how mailbox permissions interact with `sender`, `from`,
  and Sent Items placement.
- It is the official seam behind `Mail.Send.Shared` style realism.

### Extended Properties And Open Extensions

- Message resource:
  https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0

Why it matters:

- Some consumers store mailbox-specific state in Graph extended properties.

### Mail Folders Beyond Inbox

- mailFolder resource:
  https://learn.microsoft.com/en-us/graph/api/resources/mailfolder?view=graph-rest-1.0

Why it matters:

- Hidden folders, search folders, sync-issue folders, and recoverable-items
  folders are useful for realistic edge cases.

### Outlook Message Organization Guidance

- https://learn.microsoft.com/en-us/graph/outlook-organize-messages

Why it matters:

- This guide helps frame the official patterns around folders, move/copy, and
  Outlook mail behaviors beyond the pure REST reference.

### Throttling

- https://learn.microsoft.com/en-us/graph/throttling

Why it matters:

- Realistic network and provider-fault simulation should eventually reflect
  Graph throttling guidance and retry expectations.

## Graph-Specific Mocking Notes

The official references above suggest a few Graph-specific fidelity rules:

- Treat delta and upload-session URLs as opaque.
- Preserve folder-centric mailbox behavior as the canonical model.
- Keep read, write, and send permissions distinct.
- Support both JSON-resource and MIME-oriented mail operations.
- Distinguish attachment types:
  - fileAttachment
  - itemAttachment
  - referenceAttachment
- Consider immutable-ID mode as a provider feature flag, not an application
  invention.
- Notification validation and lifecycle events are part of the real black-box
  surface.

## Shortlist For `email-connect`

If this catalog is used to guide the Graph package, the most important reference
surfaces to keep close at hand are:

- Auth code flow:
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- OIDC scopes:
  https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc
- UserInfo:
  https://learn.microsoft.com/en-us/entra/identity-platform/userinfo
- Permissions reference:
  https://learn.microsoft.com/en-us/graph/permissions-reference
- Message resource:
  https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
- List messages:
  https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- Get message:
  https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0
- List attachments:
  https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0
- Get attachment:
  https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0
- Large attachment upload session:
  https://learn.microsoft.com/en-us/graph/api/attachment-createuploadsession?view=graph-rest-1.0
- Delta query:
  https://learn.microsoft.com/en-us/graph/delta-query-messages
- Change notifications:
  https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- Lifecycle events:
  https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events
- Immutable IDs:
  https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- Send mail:
  https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- Create reply:
  https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0
- Send existing draft:
  https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0
