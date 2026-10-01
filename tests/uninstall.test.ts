import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/core/workspace.js';
import { run } from '../src/core/fs.js';
import { inspectUninstall, uninstall } from '../src/services/uninstall.js';

vi.mock('../src/core/fs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/fs.js')>()),
  run: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true });
});
async function fixture(installed = true) {
  const root = await fs.mkdtemp(join(tmpdir(), 'etymon-uninstall-test-'));
  directories.push(root);
  const personal = new Workspace({
    global: true,
    home: join(root, 'home'),
    cwd: join(root, 'project'),
  });
  await fs.mkdir(personal.agents, { recursive: true });
  await fs.writeFile(personal.manifestPath, 'personal manifest');
  await fs.writeFile(personal.lockPath, 'personal lock');
  const npmRoot = join(root, 'npm-global/lib/node_modules');
  const packagePath = join(npmRoot, 'etymon/package.json');
  if (installed) {
    await fs.mkdir(join(npmRoot, 'etymon'), { recursive: true });
    await fs.writeFile(packagePath, JSON.stringify({ name: 'etymon', version: '0.0.0-test' }));
  }
  vi.mocked(run).mockImplementation(async (_command, args) => {
    if (args[0] === 'root') return npmRoot;
    throw new Error('npm removal denied');
  });
  return { root, personal, packagePath };
}
it('keeps personal files when npm uninstall fails', async () => {
  const { personal, packagePath } = await fixture();
  await expect(uninstall(personal, true)).rejects.toThrow('npm removal denied');
  expect(await fs.readFile(personal.manifestPath, 'utf8')).toBe('personal manifest');
  expect(await fs.readFile(personal.lockPath, 'utf8')).toBe('personal lock');
  expect(await fs.readFile(packagePath, 'utf8')).toContain('etymon');
});
it('refuses symlinked personal config before uninstalling the package', async () => {
  const { personal, root } = await fixture();
  const outside = join(root, 'other-project.toml');
  await fs.writeFile(outside, 'keep this');
  await fs.rm(personal.manifestPath);
  await fs.symlink(outside, personal.manifestPath);
  await expect(uninstall(personal, true)).rejects.toMatchObject({ code: 'SYMLINK_CONFLICT' });
  expect(await fs.readFile(outside, 'utf8')).toBe('keep this');
  expect(vi.mocked(run).mock.calls.every(([, args]) => args[0] === 'root')).toBe(true);
});
it('refuses a directory masquerading as a personal lockfile', async () => {
  const { personal } = await fixture();
  await fs.rm(personal.lockPath);
  await fs.mkdir(personal.lockPath);
  await fs.writeFile(join(personal.lockPath, 'keep'), 'still here');
  await expect(uninstall(personal, true)).rejects.toMatchObject({ code: 'UNINSTALL_FILE_INVALID' });
  expect(await fs.readFile(join(personal.lockPath, 'keep'), 'utf8')).toBe('still here');
  expect(vi.mocked(run).mock.calls.every(([, args]) => args[0] === 'root')).toBe(true);
});
it('leaves the installation in place while a personal environment operation is active', async () => {
  const { personal, packagePath } = await fixture();
  await fs.mkdir(personal.runtime);
  await fs.writeFile(join(personal.runtime, 'operation.lock'), 'active operation');
  await expect(uninstall(personal, true)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  expect(await fs.readFile(packagePath, 'utf8')).toContain('etymon');
  expect(vi.mocked(run).mock.calls.every(([, args]) => args[0] === 'root')).toBe(true);
});
it('rejects project-scoped service calls', async () => {
  const { root, packagePath } = await fixture();
  const project = new Workspace({ cwd: join(root, 'project'), home: join(root, 'home') });
  await expect(uninstall(project, false)).rejects.toMatchObject({ code: 'UNINSTALL_SCOPE' });
  expect(await fs.readFile(packagePath, 'utf8')).toContain('etymon');
});
it('can remove personal config without a global installation', async () => {
  const { personal } = await fixture(false);
  expect((await inspectUninstall(personal)).installation).toBeNull();
  const result = await uninstall(personal, true);
  expect(result.uninstalled).toBe(false);
  expect(result.removedFiles).toEqual([personal.manifestPath, personal.lockPath]);
  await expect(fs.access(personal.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(personal.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('refuses unexpected global package metadata', async () => {
  const { personal, packagePath } = await fixture();
  await fs.writeFile(packagePath, JSON.stringify({ name: 'someone-else', version: '1.0.0' }));
  await expect(uninstall(personal, true)).rejects.toMatchObject({ code: 'NPM_PACKAGE_INVALID' });
  expect(await fs.readFile(personal.manifestPath, 'utf8')).toBe('personal manifest');
});
