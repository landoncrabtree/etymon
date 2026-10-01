import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { atomicWrite, digest, exists, noSymlink, readOptional, stable } from './fs.js';
import { Diagnostic, EtymonError, json } from './model.js';
import { Workspace } from './workspace.js';
import { DocumentFormat, editDocument, entry, readDocument } from './documents.js';
import { Unit } from '../harnesses/render.js';

const ownedSchema = z
  .object({
    path: z.string(),
    key: z.array(z.string()).optional(),
    digest: z.string(),
    resources: z.array(z.string()),
    harnesses: z.array(z.string()),
    adopted: z.boolean().optional(),
  })
  .strict();
const stateSchema = z
  .object({ version: z.literal(1), targets: z.array(z.string()), units: z.array(ownedSchema) })
  .strict();
export type State = z.infer<typeof stateSchema>;
type Owned = z.infer<typeof ownedSchema>;
export type FileChange = { path: string; before?: Buffer; after?: Buffer; mode: number };
export type Plan = {
  changes: FileChange[];
  diagnostics: Diagnostic[];
  state: State;
  summary: { path: string; action: 'create' | 'update' | 'remove' }[];
};
export async function readState(workspace: Workspace): Promise<State> {
  const text = await readOptional(workspace.statePath);
  if (!text) return { version: 1, targets: [], units: [] };
  try {
    return stateSchema.parse(JSON.parse(text));
  } catch (e) {
    throw new EtymonError('INVALID_STATE', `Invalid ownership state: ${e}`);
  }
}
const unitId = (unit: Pick<Unit, 'path' | 'key'>) =>
  unit.path + '\0' + JSON.stringify(unit.key ?? []);
const formatOf = (path: string): DocumentFormat => (path.endsWith('.toml') ? 'toml' : 'json');
const unitHash = (unit: Unit) =>
  unit.content !== undefined ? digest(unit.content) : digest(stable(unit.value));
async function currentHash(
  unit: Pick<Unit, 'path' | 'key'>,
  bytes: Buffer | undefined,
): Promise<string | undefined> {
  if (bytes === undefined) return undefined;
  if (!unit.key) return digest(bytes);
  const value = entry(readDocument(bytes.toString('utf8'), formatOf(unit.path)), unit.key);
  return value === undefined ? undefined : digest(stable(value));
}
export async function planUnits(
  workspace: Workspace,
  units: Unit[],
  targets: string[],
  options: { adopt?: boolean; force?: boolean } = {},
): Promise<Plan> {
  const old = await readState(workspace),
    desired = new Map<string, Unit>(),
    diagnostics: Diagnostic[] = [];
  for (const unit of units) {
    const id = unitId(unit),
      existing = desired.get(id);
    if (existing) {
      if (unitHash(existing) !== unitHash(unit))
        throw new EtymonError(
          'MULTI_TARGET_COLLISION',
          `Targets require incompatible output at ${unit.path}`,
        );
      existing.harnesses = [...new Set([...existing.harnesses, ...unit.harnesses])];
      existing.resources = [...new Set([...existing.resources, ...unit.resources])];
    } else desired.set(id, { ...unit });
  }
  for (const unit of desired.values())
    if (unit.key && [...desired.values()].some((u) => u.path === unit.path && !u.key))
      throw new EtymonError(
        'OWNERSHIP_COLLISION',
        `Cannot manage both a file and entries in ${unit.path}`,
      );
  const buffers = new Map<string, Buffer | undefined>(),
    modes = new Map<string, number>();
  const oldById = new Map(old.units.map((u) => [unitId(u), u]));
  const paths = new Set([
    ...units.map((u) => u.path),
    ...old.units.filter((u) => u.harnesses.some((h) => targets.includes(h))).map((u) => u.path),
  ]);
  for (const path of paths) {
    await noSymlink(path, workspace.boundary(path));
    if (await exists(path)) {
      const stat = await fs.stat(path);
      if (!stat.isFile())
        throw new EtymonError('DESTINATION_CONFLICT', `Expected a file at ${path}`);
      buffers.set(path, await fs.readFile(path));
      modes.set(path, stat.mode & 0o777);
    } else buffers.set(path, undefined);
  }
  const newOwned: Owned[] = old.units.filter((u) => !u.harnesses.some((h) => targets.includes(h)));
  const pending = new Map<string, Buffer | undefined>(buffers);
  for (const [id, unit] of desired) {
    const previous = oldById.get(id),
      before = buffers.get(unit.path),
      current = await currentHash(unit, before),
      next = unitHash(unit);
    if (!previous && current !== undefined && !options.adopt)
      throw new EtymonError(
        'UNMANAGED_CONFLICT',
        `Unmanaged output exists at ${unit.path}${unit.key ? ' [' + unit.key.join('.') + ']' : ''}. Review --dry-run and use --adopt to take ownership.`,
      );
    if (previous && current !== undefined && current !== previous.digest && !options.force)
      throw new EtymonError(
        'MANAGED_DRIFT',
        `Managed output was edited: ${unit.path}. Import edits with convert, or use --force after reviewing.`,
      );
    const retained = previous?.harnesses.filter((h) => !targets.includes(h)) ?? [];
    if (retained.length && previous?.digest !== next)
      throw new EtymonError(
        'SHARED_TARGET_CONFLICT',
        `Output at ${unit.path} is also owned by ${retained.join(', ')}. Sync those targets together.`,
      );
    if (unit.key) {
      const text =
        pending.get(unit.path)?.toString('utf8') ?? (formatOf(unit.path) === 'toml' ? '' : '{}\n');
      pending.set(
        unit.path,
        Buffer.from(editDocument(text, unit.key, unit.value, formatOf(unit.path))),
      );
    } else pending.set(unit.path, unit.content);
    const owned = {
      path: unit.path,
      key: unit.key,
      digest: next,
      resources: unit.resources,
      harnesses: [...new Set([...unit.harnesses, ...retained])],
      ...(options.adopt && !previous ? { adopted: true } : {}),
    };
    const index = newOwned.findIndex((u) => unitId(u) === id);
    if (index >= 0) newOwned.splice(index, 1);
    newOwned.push(owned);
    modes.set(unit.path, modes.get(unit.path) ?? unit.mode ?? 0o600);
  }
  for (const previous of old.units) {
    const id = unitId(previous);
    if (desired.has(id) || !previous.harnesses.some((h) => targets.includes(h))) continue;
    const retained = previous.harnesses.filter((h) => !targets.includes(h));
    if (retained.length) {
      newOwned.push({ ...previous, harnesses: retained });
      continue;
    }
    const current = await currentHash(previous, buffers.get(previous.path));
    if (current !== undefined && current !== previous.digest) {
      diagnostics.push({
        code: 'REMOVAL_DRIFT',
        severity: 'error',
        message: `Edited output is preserved at ${previous.path}; import edits before removing`,
        resource: previous.resources[0],
      });
      newOwned.push(previous);
      continue;
    }
    if (current === undefined) continue;
    if (previous.key) {
      const text = pending.get(previous.path)!.toString('utf8');
      pending.set(
        previous.path,
        Buffer.from(editDocument(text, previous.key, undefined, formatOf(previous.path))),
      );
    } else pending.set(previous.path, undefined);
  }
  const changes: FileChange[] = [];
  for (const [path, after] of pending) {
    const before = buffers.get(path);
    if (
      (before?.equals(after ?? Buffer.alloc(0)) && after !== undefined) ||
      (before === undefined && after === undefined)
    )
      continue;
    changes.push({ path, before, after, mode: modes.get(path) ?? 0o600 });
  }
  const state: State = {
    version: 1,
    targets: [...new Set([...old.targets, ...targets])],
    units: newOwned.sort((a, b) => unitId(a).localeCompare(unitId(b))),
  };
  return {
    changes,
    diagnostics,
    state,
    summary: changes.map((c) => ({
      path: c.path,
      action: c.after === undefined ? 'remove' : c.before === undefined ? 'create' : 'update',
    })),
  };
}
const journalSchema = z.object({
  version: z.literal(1),
  status: z.enum(['applying', 'committed']),
  attempted: z.number().int().nonnegative().optional(),
  changes: z.array(
    z.object({
      path: z.string(),
      before: z.string().optional(),
      after: z.string().optional(),
      mode: z.number(),
    }),
  ),
});
export async function recover(workspace: Workspace): Promise<boolean> {
  const path = workspace.runtime + '/journal.json';
  const text = await readOptional(path);
  if (!text) return false;
  const journal = journalSchema.parse(JSON.parse(text));
  if (journal.status === 'committed') {
    await fs.rm(path, { force: true });
    return false;
  }
  const conflicts: string[] = [];
  for (const change of journal.changes
    .slice(0, journal.attempted ?? journal.changes.length)
    .reverse()) {
    const current = (await exists(change.path)) ? await fs.readFile(change.path) : undefined;
    const before = change.before === undefined ? undefined : Buffer.from(change.before, 'base64'),
      after = change.after === undefined ? undefined : Buffer.from(change.after, 'base64');
    if (
      (current?.equals(before ?? Buffer.alloc(0)) && before !== undefined) ||
      (current === undefined && before === undefined)
    )
      continue;
    if (!(
      (current?.equals(after ?? Buffer.alloc(0)) && after !== undefined) ||
      (current === undefined && after === undefined)
    )) {
      conflicts.push(change.path);
      continue;
    }
    await noSymlink(change.path, workspace.boundary(change.path));
    if (before === undefined) await fs.rm(change.path, { force: true });
    else await atomicWrite(change.path, before, change.mode);
  }
  if (conflicts.length)
    throw new EtymonError(
      'RECOVERY_CONFLICT',
      `Interrupted output was subsequently edited at ${conflicts.join(', ')}; other changes were rolled back. Preserve these files and inspect ${path}`,
    );
  await fs.rm(path, { force: true });
  return true;
}
export async function apply(workspace: Workspace, plan: Plan): Promise<void> {
  if (plan.diagnostics.some((d) => d.severity === 'error'))
    throw new EtymonError('PLAN_BLOCKED', 'Plan has blocking diagnostics', plan.diagnostics);
  const stateBefore = (await exists(workspace.statePath))
    ? await fs.readFile(workspace.statePath)
    : undefined;
  const changes = [
    ...plan.changes,
    {
      path: workspace.statePath,
      before: stateBefore,
      after: Buffer.from(json(plan.state)),
      mode: 0o600,
    },
  ];
  const path = workspace.runtime + '/journal.json';
  await fs.mkdir(dirname(path), { recursive: true });
  const journal = {
    version: 1,
    status: 'applying',
    attempted: 0,
    changes: changes.map((c) => ({
      path: c.path,
      before: c.before?.toString('base64'),
      after: c.after?.toString('base64'),
      mode: c.mode,
    })),
  };
  await atomicWrite(path, json(journal));
  try {
    for (const [index, change] of changes.entries()) {
      await noSymlink(change.path, workspace.boundary(change.path));
      const current = (await exists(change.path)) ? await fs.readFile(change.path) : undefined;
      if (!(
        (current === undefined && change.before === undefined) ||
        (current !== undefined && change.before !== undefined && current.equals(change.before))
      ))
        throw new EtymonError('CONCURRENT_EDIT', `Output changed during planning: ${change.path}`);
      journal.attempted = index + 1;
      await atomicWrite(path, json(journal));
      if (change.after === undefined) await fs.rm(change.path, { force: true });
      else await atomicWrite(change.path, change.after, change.mode);
    }
    await atomicWrite(path, json({ ...journal, status: 'committed' }));
    await fs.rm(path, { force: true });
  } catch (error) {
    await recover(workspace);
    throw error;
  }
}
