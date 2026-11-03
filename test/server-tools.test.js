import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRpcClient } from '../scripts/rpc-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('MCP advertises rails_model_details and validates its model argument', async (t) => {
  const server = spawn(process.execPath, [path.join(root, 'src/index.js')], {
    cwd: root,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const { rpc, notify } = createRpcClient({ stdout: server.stdout, stdin: server.stdin });
  t.after(() => server.kill());

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'server-tools-test', version: '1.0.0' },
  });
  notify('notifications/initialized');

  const listed = await rpc('tools/list', {});
  const details = listed.result.tools.find((tool) => tool.name === 'rails_model_details');
  assert.ok(details, 'rails_model_details should be advertised');
  assert.deepEqual(details.inputSchema.required, ['model']);

  const invalid = await rpc('tools/call', {
    name: 'rails_model_details',
    arguments: { model: '  ' },
  });
  assert.equal(invalid.result.isError, true);
  assert.match(invalid.result.content[0].text, /model.*non-empty ActiveRecord constant name/);
});
