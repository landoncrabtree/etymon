import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function contains(value, text) {
  assert(
    JSON.stringify(value).includes(text),
    `Native discovery did not contain ${text}: ${JSON.stringify(value).slice(0, 3000)}`,
  );
}
async function trustCopilot(c) {
  const directory = join(c.home, '.copilot');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    join(directory, 'config.json'),
    JSON.stringify({ trusted_folders: [c.project], auto_update: false }),
  );
}
async function rpcClient(c) {
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    cwd: c.project,
    env: c.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(),
    trace = [];
  let sequence = 0,
    stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-30000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    trace.push({ direction: 'in', message });
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const failed = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on('error', failed);
  child.on('exit', (code) => failed(new Error(`codex app-server exited (${code}): ${stderr}`)));
  return {
    async request(method, params) {
      const id = ++sequence,
        message = { id, method, params };
      trace.push({ direction: 'out', message });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex RPC timed out: ${method}\n${stderr}`));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify(message) + '\n');
      });
    },
    notify(method) {
      child.stdin.write(JSON.stringify({ method }) + '\n');
    },
    async close() {
      lines.close();
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      timer.unref();
      await fs.writeFile(
        join(c.directory, 'codex-rpc.json'),
        JSON.stringify({ trace, stderr }, null, 2),
      );
    },
  };
}
export const nativeChecks = {
  async codex(c) {
    await c.exec('codex', ['--version']);
    await fs.mkdir(join(c.home, '.codex'), { recursive: true });
    await fs.writeFile(
      join(c.home, '.codex/config.toml'),
      `[projects.${JSON.stringify(c.project)}]\ntrust_level = "trusted"\n`,
    );
    const client = await rpcClient(c);
    try {
      await client.request('initialize', {
        clientInfo: { name: 'etymon-native-tests', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      client.notify('initialized');
      const skills = await client.request('skills/list', { cwds: [c.project], forceReload: true });
      contains(skills, 'fixture-checks');
      contains(skills, '.agents/skills/fixture-checks/SKILL.md');
      const config = await client.request('config/read', { cwd: c.project, includeLayers: true });
      contains(config, 'mcp_servers');
      contains(config, 'fixture');
      contains(config, 'fixture-server.mjs');
      assert.match(await c.read('src/AGENTS.md'), /ETYMON_NESTED_RULE/);
    } finally {
      await client.close();
    }
  },
  async opencode(c) {
    await c.exec('opencode', ['--version']);
    const config = JSON.parse(await c.exec('opencode', ['debug', 'config']));
    contains(config.mcp, 'fixture');
    contains(config.mcp, 'fixture-server.mjs');
    const skills = JSON.parse(await c.exec('opencode', ['debug', 'skill']));
    contains(skills, 'fixture-checks');
    const agent = JSON.parse(await c.exec('opencode', ['debug', 'agent', 'fixture-reviewer']));
    contains(agent, 'ETYMON_AGENT_BODY');
    contains(agent, 'subagent');
  },
  async kilo(c) {
    await c.exec('kilo', ['--version']);
    const config = JSON.parse(await c.exec('kilo', ['debug', 'config']));
    contains(config.mcp, 'fixture');
    contains(config.mcp, 'fixture-server.mjs');
    const skills = JSON.parse(await c.exec('kilo', ['debug', 'skill']));
    contains(skills, 'fixture-checks');
    const agent = JSON.parse(await c.exec('kilo', ['debug', 'agent', 'fixture-reviewer']));
    contains(agent, 'ETYMON_AGENT_BODY');
  },
  async gemini(c) {
    await c.exec('gemini', ['--version']);
    // Trust only the isolated fixture through Gemini's documented headless flag.
    const settings = { env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' }, combineOutput: true };
    const skills = await c.exec('gemini', ['skills', 'list'], settings);
    assert.match(skills, /fixture-checks/);
    const mcp = await c.exec('gemini', ['mcp', 'list'], settings);
    assert.match(mcp, /fixture[\s\S]*Connected/);
  },
  async pi(c) {
    await c.exec('pi', ['--version']);
    let packageDirectory;
    for (const directory of c.env.PATH.split(':')) {
      try {
        let current = dirname(await fs.realpath(join(directory, 'pi')));
        while (dirname(current) !== current) {
          try {
            const pkg = JSON.parse(await fs.readFile(join(current, 'package.json'), 'utf8'));
            if (pkg.name === '@earendil-works/pi-coding-agent') {
              packageDirectory = current;
              break;
            }
          } catch {
            /* Continue to the package root. */
          }
          current = dirname(current);
        }
      } catch {
        /* Try the next PATH directory. */
      }
      if (packageDirectory) break;
    }
    assert(
      packageDirectory,
      'Install the npm Pi package so its real resource-loader SDK is available',
    );
    const script = fileURLToPath(new URL('./pi-inspect.mjs', import.meta.url));
    const result = JSON.parse(
      await c.exec(process.execPath, [script, packageDirectory, c.project, c.home]),
    );
    contains(result.skills, 'fixture-checks');
    contains(result.root, 'ETYMON_ROOT_RULE');
    contains(result.nested, 'ETYMON_NESTED_RULE');
  },
  async copilot(c) {
    await c.exec('copilot', ['--no-auto-update', '--version']);
    await trustCopilot(c);
    const instructions = JSON.parse(
      await c.exec('copilot', ['--no-auto-update', 'instruction', 'list', '--json']),
    );
    contains(instructions, 'AGENTS.md');
    const nested = JSON.parse(
      await c.exec('copilot', ['--no-auto-update', 'instruction', 'list', '--json'], {
        cwd: join(c.project, 'src'),
      }),
    );
    contains(nested, 'src/AGENTS.md');
    const skills = JSON.parse(
      await c.exec('copilot', ['--no-auto-update', 'skill', 'list', '--json']),
    );
    contains(skills, 'fixture-checks');
    const mcp = JSON.parse(await c.exec('copilot', ['--no-auto-update', 'mcp', 'list', '--json']));
    contains(mcp, 'fixture');
    contains(mcp, 'fixture-server.mjs');
  },
  async claude(c) {
    await c.exec('claude', ['--version']);
    // Inspect configuration without starting the fixture process or a model session.
    const mcp = await c.exec('claude', ['mcp', 'get', 'fixture']);
    assert.match(mcp, /fixture-server\.mjs/);
    assert.match(mcp, /[Pp]roject/);
  },
};
