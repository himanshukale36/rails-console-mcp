#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRpcClient } from './rpc-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'index.js');

const RAILS_CWD = process.env.RAILS_CONSOLE_MCP_CWD;
if (!RAILS_CWD) {
  console.error(
    'Set RAILS_CONSOLE_MCP_CWD to an absolute path to a Rails app before running the smoke test.\n' +
      'Example: RAILS_CONSOLE_MCP_CWD=/path/to/rails/app npm run smoke'
  );
  process.exit(2);
}

const proc = spawn('node', [serverPath], {
  cwd: process.cwd(),
  env: { ...process.env, RAILS_CONSOLE_MCP_CWD: RAILS_CWD },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const { rpc, notify } = createRpcClient({ stdout: proc.stdout, stdin: proc.stdin });

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.1' },
  });
  notify('notifications/initialized');

  const tools = await rpc('tools/list', {});
  console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));

  console.log('booting rails console (first eval will take a while)...');
  const t0 = Date.now();
  const first = await rpc('tools/call', {
    name: 'rails_eval',
    arguments: { code: 'puts "hello from rails"; 1 + 1', timeout_ms: 600_000 },
  });
  console.log(`first eval took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('first result:\n' + first.result.content[0].text);

  const t1 = Date.now();
  const second = await rpc('tools/call', {
    name: 'rails_eval',
    arguments: { code: 'User.count' },
  });
  console.log(`second eval took ${((Date.now() - t1) / 1000).toFixed(2)}s`);
  console.log('second result:\n' + second.result.content[0].text);

  const status = await rpc('tools/call', {
    name: 'rails_status',
    arguments: {},
  });
  console.log('status:\n' + status.result.content[0].text);

  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  proc.kill();
  process.exit(1);
});
