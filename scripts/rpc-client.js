export function createRpcClient({ stdout, stdin, defaultTimeoutMs = 700_000 }) {
  const pending = new Map();
  let nextId = 1;
  let buf = '';

  stdout.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg);
      }
    }
  });

  function rpc(method, params, { timeoutMs = defaultTimeoutMs } = {}) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  function notify(method, params) {
    stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  return { rpc, notify };
}
