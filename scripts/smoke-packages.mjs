import { copyFileSync, cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'email-connect-smoke-'));
const scopedNodeModulesDir = path.join(runtimeDir, 'node_modules', '@email-connect');
const rootNodeModulesDir = path.join(runtimeDir, 'node_modules');

mkdirSync(scopedNodeModulesDir, { recursive: true });

for (const packageName of ['core', 'gmail', 'graph']) {
  const runtimePackageDir = path.join(scopedNodeModulesDir, packageName);
  mkdirSync(runtimePackageDir, { recursive: true });
  copyFileSync(path.join(rootDir, 'packages', packageName, 'package.json'), path.join(runtimePackageDir, 'package.json'));
  cpSync(path.join(rootDir, 'packages', packageName, 'dist'), path.join(runtimePackageDir, 'dist'), { recursive: true });
}

const runtimeRootPackageDir = path.join(rootNodeModulesDir, 'email-connect');
mkdirSync(runtimeRootPackageDir, { recursive: true });
copyFileSync(path.join(rootDir, 'package.json'), path.join(runtimeRootPackageDir, 'package.json'));
cpSync(path.join(rootDir, 'dist'), path.join(runtimeRootPackageDir, 'dist'), { recursive: true });

const runnerPath = path.join(runtimeDir, 'runner.mjs');
writeFileSync(
  runnerPath,
  `
import assert from 'node:assert/strict';

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

const core = await import('@email-connect/core');
const gmail = await import('@email-connect/gmail');
const graph = await import('@email-connect/graph');
const combined = await import('email-connect');
const combinedServer = await import('email-connect/server');

const gmailEngine = new core.EmailConnectEngine({
  baseTime: '2026-04-14T12:00:00.000Z',
  providers: [gmail.gmailProvider],
});
gmailEngine.createMailbox({
  id: 'gmail-built',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});
gmailEngine.appendMessage('gmail-built', {
  providerMessageId: 'gmail-built-msg-1',
  subject: 'Built Gmail smoke',
  bodyText: 'Inbox message through built package imports.',
});
const gmailClient = gmail.getGmailClientForMailbox(gmailEngine, 'gmail-built');
const gmailMessages = await gmailClient.users.messages.list({ userId: 'me' });
assert.equal(gmailMessages.data.messages.length, 1);
assert.equal(gmailMessages.data.messages[0].id, 'gmail-built-msg-1');
assert.equal(typeof gmailMessages.data.messages[0].threadId, 'string');
assert.ok(gmailMessages.data.messages[0].threadId.length > 0);
assert.throws(
  () =>
    gmailEngine.createMailbox({
      id: 'graph-not-installed',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    }),
  /Provider is not installed: graph/,
);

const graphEngine = new core.EmailConnectEngine({
  baseTime: '2026-04-14T12:00:00.000Z',
  providers: [graph.graphProvider],
});
graphEngine.createMailbox({
  id: 'graph-built',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});
graphEngine.appendMessage('graph-built', {
  providerMessageId: 'graph-built-msg-1',
  subject: 'Built Graph smoke',
  bodyText: 'Graph inbox message through built package imports.',
});
const graphClient = graph.getOutlookGraphClientForMailbox(graphEngine, 'graph-built');
const graphInbox = await graphClient.client.api('/me/mailFolders/inbox/messages?$top=1').get();
assert.equal(graphInbox.value.length, 1);
assert.equal(graphInbox.value[0].id, 'graph-built-msg-1');
assert.throws(
  () =>
    graphEngine.createMailbox({
      id: 'gmail-not-installed',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    }),
  /Provider is not installed: gmail/,
);

const engine = new combined.EmailConnectEngine({
  baseTime: '2026-04-14T12:00:00.000Z',
});
const gmailMailbox = engine.createMailbox({
  id: 'combined-gmail',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});
engine.createMailbox({
  id: 'combined-graph',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});

const server = new combinedServer.EmailConnectHttpServer({ engine });
const { baseUrl, adminToken } = await server.listen();
try {
  const seeded = await jsonFetch(\`\${baseUrl}/__email-connect/v1/mailboxes/combined-gmail/messages\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-connect-admin-token': adminToken,
    },
    body: JSON.stringify({
      providerMessageId: 'combined-built-msg-1',
      subject: 'Combined built smoke',
      bodyText: 'Root server smoke path.',
    }),
  });
  assert.equal(seeded.response.status, 201);

  const profile = await jsonFetch(\`\${baseUrl}/gmail/v1/users/me/profile\`, {
    headers: {
      Authorization: \`Bearer \${gmailMailbox.accessToken}\`,
    },
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.emailAddress, 'ops@example.com');
} finally {
  await server.close();
}

console.log('Built package smoke checks passed.');
`,
);

try {
  await import(pathToFileURL(runnerPath).href);
} finally {
  rmSync(runtimeDir, { recursive: true, force: true });
}
