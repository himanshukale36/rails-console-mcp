import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// npm's tar extraction strips +x from node-pty's prebuilt spawn-helper on some
// setups; without this chmod, pty.spawn throws "posix_spawnp failed".
try {
  const require_ = createRequire(import.meta.url);
  const nodePtyPkg = require_.resolve('node-pty/package.json');
  const prebuildsDir = path.join(path.dirname(nodePtyPkg), 'prebuilds');
  if (fs.existsSync(prebuildsDir)) {
    for (const sub of fs.readdirSync(prebuildsDir)) {
      const helper = path.join(prebuildsDir, sub, 'spawn-helper');
      if (fs.existsSync(helper)) {
        try {
          fs.chmodSync(helper, 0o755);
        } catch {}
      }
    }
  }
} catch {}

const { default: pty } = await import('node-pty');

const CONSOLE_HYGIENE_ENV = {
  TERM: 'dumb',
  PAGER: 'cat',
  IRB_USE_AUTOCOMPLETE: 'false',
};

const MAX_BUFFER_BYTES = 2_000_000;

const stripAnsi = (s) =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function describeBootFailure(output, { cwd, command, exitCode, signal }) {
  const clean = stripAnsi(output || '').trim();
  const status = ` (exit code ${exitCode ?? 'unknown'}, signal ${signal ?? 'none'})`;
  const block = clean.match(/The following gems are missing\s*([\s\S]*?)(?:\n\s*Install missing gems with|$)/i);
  const missing = block?.[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\*\s+/.test(line))
    .map((line) => line.replace(/^\*\s+/, ''));

  const unresolvedBundle = /Bundler::GemNotFound|Could not find gem|The following gems are missing|in locally installed gems|Run .*bundle install/i.test(clean);
  if (missing?.length || unresolvedBundle) {
    const gemList = missing?.length
      ? ` Missing gems: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}.`
      : '';
    return new Error(
      `Rails console could not boot${status}: Bundler cannot resolve this app's gems for the configured Ruby.` +
      `${gemList} Run \`bundle install --gemfile ${path.join(cwd, 'Gemfile')}\`, then retry. Launch command: ${command}.`
    );
  }

  if (/bin\/rails: not found|command not found|No such file or directory/i.test(clean)) {
    return new Error(
      `Rails console could not boot${status}: the app path or launch command is invalid. ` +
      `Check RAILS_CONSOLE_MCP_CWD (${cwd}) and RAILS_CONSOLE_MCP_COMMAND (${command}).`
    );
  }

  const tail = clean.slice(-1200);
  return new Error(
    `rails console exited before it was ready${status}. Check the app's Ruby/Bundler setup.` +
    (tail ? ` Console output: ${tail}` : '')
  );
}

export class RailsConsole {
  constructor({
    cwd,
    cols = 1000,
    rows = 50,
    bootTimeoutMs = 600_000,
    command = 'bin/rails c',
    railsEnv = 'development',
    extraEnv = {},
    ptySpawn = pty.spawn,
  } = {}) {
    if (!cwd) throw new Error('RailsConsole: cwd is required');
    this.cwd = cwd;
    this.cols = cols;
    this.rows = rows;
    this.bootTimeoutMs = bootTimeoutMs;
    this.command = command;
    this.railsEnv = railsEnv;
    this.extraEnv = extraEnv;
    this.ptySpawn = ptySpawn;

    this.proc = null;
    this.buffer = '';
    this.readyAt = null;
    this.startedAt = null;
    this.bootPromise = null;
    this.lastExitError = null;
    this.lastBootError = null;
    this.lastOp = Promise.resolve();
    this.queuedOps = 0;
    this.pendingTokens = new Map();
  }

  status() {
    return {
      running: !!this.proc,
      cwd: this.cwd,
      command: this.command,
      rails_env: this.railsEnv,
      extra_env_keys: Object.keys(this.extraEnv),
      pid: this.proc?.pid ?? null,
      started_at: this.startedAt,
      ready_at: this.readyAt,
      ready: !!this.readyAt,
      busy: this.pendingTokens.size > 0,
      queued: this.queuedOps,
      last_error: this.lastBootError,
    };
  }

  isReady() {
    return !!this.readyAt && !!this.proc;
  }

  _enqueue(fn) {
    const prev = this.lastOp;
    this.queuedOps += 1;
    const run = async () => {
      this.queuedOps -= 1;
      return fn();
    };
    const next = prev.then(run, run);
    prev.catch(() => {});
    this.lastOp = next.catch(() => {});
    return next;
  }

  async ensureStarted() {
    if (this.readyAt) return;
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = this._boot().finally(() => {
      if (!this.readyAt) this.bootPromise = null;
    });
    return this.bootPromise;
  }

  async _boot() {
    this.startedAt = new Date().toISOString();
    this.buffer = '';
    this.lastExitError = null;
    this.lastBootError = null;
    this.pendingTokens.clear();

    const proc = this.ptySpawn('/bin/sh', ['-c', `exec ${this.command}`], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...process.env,
        RAILS_ENV: this.railsEnv,
        ...this.extraEnv,
        ...CONSOLE_HYGIENE_ENV,
      },
    });
    this.proc = proc;

    proc.onData((data) => {
      if (this.proc !== proc) return;
      this._absorbData(data);
    });

    proc.onExit(({ exitCode, signal }) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.readyAt = null;
      this.bootPromise = null;
      const err = new Error(
        `rails console exited (code=${exitCode}, signal=${signal ?? 'none'})`
      );
      err.exitCode = exitCode;
      err.signal = signal;
      this.lastExitError = err;
      this._rejectAllPendingTokens(err);
    });

    const readyToken = `__RAILS_MCP_READY__${randomUUID()}`;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (this.proc !== proc) {
      const error = describeBootFailure(this.buffer, {
        cwd: this.cwd,
        command: this.command,
        exitCode: this.lastExitError?.exitCode,
        signal: this.lastExitError?.signal,
      });
      this.lastBootError = error.message;
      throw error;
    }
    const wait = this._watchToken(`${readyToken}\n`, 1, this.bootTimeoutMs, 'timed out waiting for rails console to become ready');
    proc.write(`puts '${readyToken}'\n`);
    try {
      await wait;
    } catch (err) {
      const diagnosis = describeBootFailure(this.buffer, {
        cwd: this.cwd,
        command: this.command,
        exitCode: this.lastExitError?.exitCode,
        signal: this.lastExitError?.signal,
      });
      const error = /Bundler reports gems missing|app path or launch command is invalid/.test(diagnosis.message)
        ? diagnosis
        : err;
      this.lastBootError = error.message;
      if (this.proc === proc) this._killProcAndReset('console boot failed');
      throw error;
    }

    this.buffer = '';
    this.readyAt = new Date().toISOString();
    this.lastBootError = null;
  }

  _absorbData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_BYTES);
    }
    // Real consoles emit `\r\n` and inject ANSI color codes into echoed input;
    // both would prevent the raw counter from matching markers like `<token>\n`.
    const normalised = stripAnsi(chunk);
    for (const [token, entry] of this.pendingTokens) {
      const scan = (entry.carry ?? '') + normalised;
      let idx = 0;
      let hits = 0;
      while ((idx = scan.indexOf(token, idx)) !== -1) {
        hits += 1;
        idx += token.length;
      }
      const carryLen = token.length - 1;
      entry.carry = scan.length > carryLen ? scan.slice(-carryLen) : scan;
      if (hits > 0) {
        entry.count += hits;
        if (entry.count >= entry.threshold) {
          for (const r of entry.resolvers.splice(0)) r.resolve();
          this.pendingTokens.delete(token);
        }
      }
    }
  }

  _watchToken(token, threshold, timeoutMs, timeoutMessage) {
    const entry = this.pendingTokens.get(token) || {
      count: 0,
      threshold,
      resolvers: [],
    };
    entry.threshold = threshold;
    this.pendingTokens.set(token, entry);

    return new Promise((resolve, reject) => {
      if (entry.count >= entry.threshold) {
        this.pendingTokens.delete(token);
        resolve();
        return;
      }
      const waiter = { resolve: null, reject: null, timer: null };
      const done = () => {
        if (waiter.timer) clearTimeout(waiter.timer);
        const idx = entry.resolvers.indexOf(waiter);
        if (idx >= 0) entry.resolvers.splice(idx, 1);
        if (entry.resolvers.length === 0) this.pendingTokens.delete(token);
      };
      waiter.resolve = () => { done(); resolve(); };
      waiter.reject = (err) => { done(); reject(err); };
      waiter.timer = setTimeout(() => {
        waiter.reject(new Error(`${timeoutMessage}\n---BUFFER TAIL---\n${stripAnsi(this.buffer).slice(-4000)}`));
      }, timeoutMs);
      entry.resolvers.push(waiter);
    });
  }

  _rejectAllPendingTokens(err) {
    for (const entry of this.pendingTokens.values()) {
      for (const waiter of entry.resolvers.splice(0)) {
        try { waiter.reject(err); } catch {}
      }
    }
    this.pendingTokens.clear();
  }

  async evalCode(code, { timeoutMs = 120_000, requireReady = false } = {}) {
    if (requireReady && !this.isReady()) {
      const err = new Error('CONSOLE_NOT_READY');
      err.code = 'CONSOLE_NOT_READY';
      throw err;
    }
    return this._enqueue(async () => {
      await this.ensureStarted();
      return this._runOnce(code, timeoutMs);
    });
  }

  async _runOnce(code, timeoutMs) {
    const token = `__RAILS_MCP_DONE__${randomUUID()}`;
    this.buffer = '';

    const encoded = Buffer.from(code, 'utf8').toString('base64');
    const wrapped =
      `begin; _r = Kernel.eval(%q(${encoded}).unpack1(%q(m0)), TOPLEVEL_BINDING); ` +
      `STDOUT.print(_r.inspect + "\\n"); ` +
      `rescue Exception => e; ` +
      `STDOUT.print("[rails_mcp exception] " + e.class.name + ": " + e.message + "\\n" + e.backtrace.first(15).join("\\n") + "\\n"); ` +
      `ensure; STDOUT.print("\\n${token}\\n"); STDOUT.flush; end\n`;

    // `\n<token>\n` (real LFs) matches only the printed sighting; the echoed
    // wrapper contains the literal source chars `\\n<token>\\n` (backslash-n).
    const flanked = `\n${token}\n`;
    const wait = this._watchToken(flanked, 1, timeoutMs, `timed out after ${timeoutMs}ms waiting for eval to finish`);
    this.proc.write(wrapped);

    try {
      await wait;
    } catch (err) {
      this._killProcAndReset('eval timed out; console killed');
      throw err;
    }

    const clean = stripAnsi(this.buffer);
    const flankedIdx = clean.indexOf(flanked);
    let output = flankedIdx >= 0 ? clean.slice(0, flankedIdx) : clean;
    output = output.trimStart();

    output = output
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^irb\(.*\):\d+[:*>]/.test(trimmed)) return false;
        if (trimmed === '=> nil') return false; // IRB's result for the MCP wrapper, not the user's expression.
        if (/^\[\d+\]\s+pry\(.*\)>/.test(trimmed)) return false;
        if (/^[a-z][a-z0-9_-]*\(.+\)>/.test(trimmed)) return false;
        if (/^▽/.test(trimmed)) return false;
        if (trimmed.includes(token)) return false;
        if (/STDOUT\.flush; end$/.test(trimmed)) return false;
        if (/^begin;.*Kernel\.eval/.test(trimmed)) return false;
        return true;
      })
      .join('\n')
      .trim();

    return output;
  }

  _killProcAndReset(reason) {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
    }
    this.proc = null;
    this.readyAt = null;
    this.bootPromise = null;
    this.buffer = '';
    this.pendingTokens.clear();
  }

  restart() {
    return this._enqueue(async () => {
      this._killProcAndReset('restart');
      await this.ensureStarted();
    });
  }

  shutdown() {
    this._rejectAllPendingTokens(new Error('Rails console MCP is shutting down'));
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
    }
    this.proc = null;
    this.readyAt = null;
  }
}
