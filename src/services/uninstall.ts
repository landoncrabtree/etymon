import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { exists, noSymlink, run } from '../core/fs.js';
import { EtymonError } from '../core/model.js';
import { Workspace } from '../core/workspace.js';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export type UninstallPlan = {
  installation: { path: string; version: string } | null;
  personalFiles: string[];
};

/** Inspect the active npm prefix, independently of the project's environment. */
export async function inspectUninstall(personal: Workspace): Promise<UninstallPlan> {
  const root = (await run(npm, ['root', '--global'], { debug: personal.debug })).trim();
  if (!isAbsolute(root))
    throw new EtymonError('NPM_ROOT_INVALID', 'npm returned an invalid global directory');
  const path = join(root, 'etymon');
  let installation: UninstallPlan['installation'] = null;
  try {
    const pkg = JSON.parse(await fs.readFile(join(path, 'package.json'), 'utf8'));
    if (pkg.name !== 'etymon' || typeof pkg.version !== 'string')
      throw new EtymonError('NPM_PACKAGE_INVALID', `Cannot identify the package at ${path}`);
    installation = { path, version: pkg.version };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const personalFiles: string[] = [];
  for (const path of [personal.manifestPath, personal.lockPath])
    if (await exists(path)) personalFiles.push(path);
  return { installation, personalFiles };
}

async function validatePersonalFiles(personal: Workspace, paths: string[]): Promise<void> {
  if (!personal.global)
    throw new EtymonError('UNINSTALL_SCOPE', 'Uninstall requires the personal environment');
  for (const path of paths) {
    await noSymlink(path, personal.home);
    if ((await exists(path)) && !(await fs.lstat(path)).isFile())
      throw new EtymonError(
        'UNINSTALL_FILE_INVALID',
        `Expected a personal configuration file at ${path}`,
      );
  }
}

export async function uninstall(personal: Workspace, removeUserConfig: boolean) {
  const plan = await inspectUninstall(personal);
  const filesToRemove = removeUserConfig ? plan.personalFiles : [];
  await validatePersonalFiles(personal, filesToRemove);
  const apply = async () => {
    await validatePersonalFiles(personal, filesToRemove);
    if (plan.installation) {
      // Load the optional UI before this call: npm removes the running package.
      await run(
        npm,
        ['uninstall', '--global', 'etymon', '--ignore-scripts', '--no-audit', '--no-fund'],
        {
          debug: personal.debug,
        },
      );
      if (await exists(join(plan.installation.path, 'package.json')))
        throw new EtymonError(
          'UNINSTALL_INCOMPLETE',
          'npm left the global etymon package in place',
        );
    }
    for (const path of filesToRemove) await fs.rm(path, { force: true });
  };
  if (filesToRemove.length) await personal.exclusive(apply);
  else await apply();
  return {
    uninstalled: Boolean(plan.installation),
    installation: plan.installation,
    removedFiles: filesToRemove,
    keptPersonalFiles: !removeUserConfig,
  };
}
