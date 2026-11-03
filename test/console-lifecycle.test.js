import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RailsConsole } from '../src/console.js';

class FakePty extends EventEmitter {
  constructor() {
    super();
    this.pid = Math.floor(Math.random() * 1_000_000);
    this.writes = [];
    this.killed = false;
  }
  onData(cb) {
    this.on('data', cb);
  }
  onExit(cb) {
    this.on('exit', cb);
  }
  write(data) {
    this.writes.push(data);
  }
  kill() {
    this.killed = true;
    process.nextTick(() => this.emit('exit', { exitCode: 143, signal: 'SIGTERM' }));
  }
  emitData(chunk) {
    this.emit('data', chunk);
  }
}

// Emits the shape a real rails console produces in response to `puts '<token>'`:
// echoed input line, then printed output line, both matching the byte pattern
// the token watcher expects.
function autoBoot(fakePty) {
  const original = fakePty.write.bind(fakePty);
  fakePty.write = (data) => {
    original(data);
    const m = /puts '(__RAILS_MCP_READY__[a-f0-9-]+)'/.exec(data);
    if (m) {
      queueMicrotask(() => {
        fakePty.emitData(`puts '${m[1]}'\r\n\n${m[1]}\n=> nil\r\n`);
      });
    }
  };
}

function emitEvalResult(fakePty, doneToken, result = 'stub-result') {
  fakePty.emitData(`begin; _r = ...; ${doneToken}; end\r\n${result}\r\n\n${doneToken}\n=> ${result}\r\n`);
}

function buildConsole() {
  const ptys = [];
  const spawn = () => {
    const p = new FakePty();
    autoBoot(p);
    ptys.push(p);
    return p;
  };
  const c = new RailsConsole({
    cwd: '/tmp/fake-rails',
    command: 'bin/rails c',
    bootTimeoutMs: 5_000,
    ptySpawn: spawn,
  });
  return { console: c, ptys };
}

// Same as buildConsole but does NOT auto-reply to the READY puts, so tests
// can control when/if the console reaches ready state (e.g. inject an exit
// event before it ever does).
function buildConsoleNoAutoBoot(bootTimeoutMs = 5_000) {
  const ptys = [];
  const spawn = () => {
    const p = new FakePty();
    ptys.push(p);
    return p;
  };
  const c = new RailsConsole({
    cwd: '/tmp/fake-rails',
    command: 'bin/rails c',
    bootTimeoutMs,
    ptySpawn: spawn,
  });
  return { console: c, ptys };
}

test('large output does not lose the completion token', async () => {
  const { console: c, ptys } = buildConsole();
  const bootDone = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 10));
  await bootDone;
  const pty = ptys[0];

  const evalPromise = c.evalCode('big_query');
  await new Promise((r) => setTimeout(r, 10));
  const write = pty.writes[pty.writes.length - 1];
  const doneMatch = /__RAILS_MCP_DONE__[a-f0-9-]+/.exec(write);
  assert.ok(doneMatch, 'expected wrapper write to contain DONE token');
  const token = doneMatch[0];

  pty.emitData(`begin; _r = ... ; ${token}; end\r\n`);
  const junk = 'x'.repeat(3_000_000);
  pty.emitData(`${junk}\r\n\n${token}\n=> done\r\n`);

  const result = await evalPromise;
  assert.ok(typeof result === 'string');
});

test('eval timeout kills the console and next eval boots a fresh one', async () => {
  const { console: c, ptys } = buildConsole();
  const bootDone = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 10));
  await bootDone;
  const firstPty = ptys[0];
  assert.equal(ptys.length, 1);

  const stuck = c.evalCode('sleep 999', { timeoutMs: 100 });
  await assert.rejects(stuck, /timed out/);
  assert.equal(firstPty.killed, true, 'wedged proc should be killed after timeout');

  const next = c.evalCode('1+1');
  const start = Date.now();
  let newPty, doneMatch;
  while (Date.now() - start < 5_000) {
    await new Promise((r) => setTimeout(r, 25));
    newPty = ptys[1];
    if (newPty) {
      const write = newPty.writes.find((w) => /__RAILS_MCP_DONE__/.test(w));
      if (write) {
        doneMatch = /__RAILS_MCP_DONE__[a-f0-9-]+/.exec(write);
        break;
      }
    }
  }
  assert.equal(ptys.length, 2, 'a fresh pty should be spawned for the next eval');
  assert.ok(doneMatch, 'next eval should write a wrapper to the fresh pty');
  const token = doneMatch[0];
  emitEvalResult(newPty, token, '2');
  const result = await next;
  assert.ok(typeof result === 'string');
});

test('restart during in-flight eval waits for eval, then reboots on a fresh proc', async () => {
  const { console: c, ptys } = buildConsole();
  const bootDone = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 10));
  await bootDone;
  const firstPty = ptys[0];

  const evalPromise = c.evalCode('slow_thing');
  await new Promise((r) => setTimeout(r, 10));
  const evalWrite = firstPty.writes[firstPty.writes.length - 1];
  const evalToken = /__RAILS_MCP_DONE__[a-f0-9-]+/.exec(evalWrite)[0];

  const restartPromise = c.restart();

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(firstPty.killed, false, 'restart must not kill proc while eval is running');
  assert.equal(ptys.length, 1, 'restart must not spawn a new proc yet');

  emitEvalResult(firstPty, evalToken, 'result');
  const evalResult = await evalPromise;
  assert.ok(typeof evalResult === 'string');

  await restartPromise;
  assert.equal(firstPty.killed, true, 'restart must kill the original proc');
  assert.equal(ptys.length, 2, 'restart must spawn a fresh proc');
  assert.ok(c.isReady(), 'console must be ready after restart');
});

test('two concurrent evals serialize strictly (no interleave)', async () => {
  const { console: c, ptys } = buildConsole();
  const bootDone = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 10));
  await bootDone;
  const pty = ptys[0];

  const p1 = c.evalCode('first');
  const p2 = c.evalCode('second');

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pty.writes.length, 2, `expected boot puts + first eval wrapper only, got ${pty.writes.length}`);

  const t1 = /__RAILS_MCP_DONE__[a-f0-9-]+/.exec(pty.writes[1])[0];
  emitEvalResult(pty, t1, 'r1');
  await p1;

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pty.writes.length, 3, 'second eval should have written its wrapper after first finished');
  const t2 = /__RAILS_MCP_DONE__[a-f0-9-]+/.exec(pty.writes[2])[0];
  emitEvalResult(pty, t2, 'r2');
  const r2 = await p2;
  assert.ok(typeof r2 === 'string');
});

test('proc exit during boot rejects the ensureStarted waiter promptly', async () => {
  const { console: c, ptys } = buildConsoleNoAutoBoot();
  const bootDone = c.ensureStarted();

  // Give ensureStarted's 500ms warmup + puts write time to register the token
  // watcher, then emit exit BEFORE the READY response ever arrives.
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(ptys.length, 1, 'boot should have spawned one pty');
  ptys[0].emit('exit', { exitCode: 1, signal: null });

  const t0 = Date.now();
  await assert.rejects(bootDone, /rails console exited/);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `boot rejection should be prompt, took ${elapsed}ms`);
});

test('boot timeout kills and resets the unresponsive console process', async () => {
  const { console: c, ptys } = buildConsoleNoAutoBoot(200);
  await assert.rejects(c.ensureStarted(), /timed out waiting for rails console to become ready/);
  assert.equal(ptys[0].killed, true, 'unresponsive console should be killed after boot timeout');
  assert.equal(c.isReady(), false);
  assert.equal(c.status().running, false);
});

test('boot failure explains missing Rails bundle gems and retains the error in status', async () => {
  const { console: c, ptys } = buildConsoleNoAutoBoot();
  const boot = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 30));
  ptys[0].emitData('The following gems are missing\n * rails (8.0.5)\n * pg (1.6.3)\nInstall missing gems with `bundle install`\n');
  ptys[0].emit('exit', { exitCode: 7, signal: null });

  await assert.rejects(boot, /Bundler cannot resolve.*rails \(8\.0\.5\).*pg \(1\.6\.3\).*bundle install/);
  assert.match(c.status().last_error, /bundle install/);
  assert.match(c.status().last_error, /\/tmp\/fake-rails/);
});

test('boot failure recognizes Bundler missing-gem output from rails startup', async () => {
  const { console: c, ptys } = buildConsoleNoAutoBoot();
  const boot = c.ensureStarted();
  await new Promise((r) => setTimeout(r, 30));
  ptys[0].emitData("Could not find rails (8.0.5.1) in locally installed gems\\nRun `bundle install --gemfile /tmp/fake-rails/Gemfile` to install missing gems\\n");
  ptys[0].emit('exit', { exitCode: 7, signal: null });

  await assert.rejects(boot, /Bundler cannot resolve.*bundle install --gemfile \/tmp\/fake-rails\/Gemfile/);
  assert.match(c.status().last_error, /configured Ruby/);
});

test('proc exit mid-eval rejects the evalCode waiter promptly', async () => {
  const { console: c, ptys } = buildConsole();
  await c.ensureStarted();
  const pty = ptys[0];

  // Start an eval and let its wrapper register the DONE token watcher, then
  // emit exit BEFORE the DONE response arrives. The waiter must reject with
  // the exit error rather than hang until timeoutMs (default 120s here).
  const evalPromise = c.evalCode('slow', { timeoutMs: 120_000 });
  await new Promise((r) => setTimeout(r, 20));
  pty.emit('exit', { exitCode: 137, signal: 'SIGKILL' });

  const t0 = Date.now();
  await assert.rejects(evalPromise, /rails console exited/);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `eval rejection should be prompt, took ${elapsed}ms`);
});
