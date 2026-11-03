import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRpcClient } from '../scripts/rpc-client.js';

function fakeStreams() {
  const stdout = new EventEmitter();
  const writes = [];
  const stdin = {
    write(chunk) {
      writes.push(chunk);
    },
  };
  const emit = (line) => stdout.emit('data', line);
  return { stdout, stdin, writes, emit };
}

test('rpc resolves with the matching response message', async () => {
  const { stdout, stdin, writes, emit } = fakeStreams();
  const { rpc } = createRpcClient({ stdout, stdin });

  const promise = rpc('ping', { hello: 'world' });
  const sent = JSON.parse(writes[0]);
  assert.equal(sent.method, 'ping');
  assert.deepEqual(sent.params, { hello: 'world' });

  emit(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { pong: true } }) + '\n');
  const msg = await promise;
  assert.deepEqual(msg.result, { pong: true });
});

test('rpc rejects when the server returns a JSON-RPC error', async () => {
  const { stdout, stdin, writes, emit } = fakeStreams();
  const { rpc } = createRpcClient({ stdout, stdin });

  const promise = rpc('nope', {});
  const sent = JSON.parse(writes[0]);
  emit(
    JSON.stringify({ jsonrpc: '2.0', id: sent.id, error: { code: -32601, message: 'no such method' } }) + '\n'
  );

  await assert.rejects(promise, /no such method/);
});

test('rpc rejects on timeout and does not leak pending entries', async () => {
  const { stdout, stdin } = fakeStreams();
  const { rpc } = createRpcClient({ stdout, stdin });

  await assert.rejects(rpc('slow', {}, { timeoutMs: 10 }), /timeout waiting for response to slow/);
});

test('rpc handles multiple newline-delimited messages in one chunk', async () => {
  const { stdout, stdin, writes, emit } = fakeStreams();
  const { rpc } = createRpcClient({ stdout, stdin });

  const p1 = rpc('a', {});
  const p2 = rpc('b', {});
  const [s1, s2] = writes.map((w) => JSON.parse(w));

  const combined =
    JSON.stringify({ jsonrpc: '2.0', id: s1.id, result: 'first' }) +
    '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: s2.id, result: 'second' }) +
    '\n';
  emit(combined);

  assert.equal((await p1).result, 'first');
  assert.equal((await p2).result, 'second');
});

test('notify writes a JSON-RPC notification (no id) and returns nothing', () => {
  const { stdout, stdin, writes } = fakeStreams();
  const { notify } = createRpcClient({ stdout, stdin });
  notify('notifications/initialized');
  const parsed = JSON.parse(writes[0]);
  assert.equal(parsed.method, 'notifications/initialized');
  assert.equal(parsed.id, undefined);
});
