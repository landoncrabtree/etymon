import { promises as fs } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { stringify as toml } from 'smol-toml';
import {
  Agent,
  ADAPTER_REVISION,
  agentSchema,
  connectionSchema,
  Diagnostic,
  EtymonError,
  json,
  Kind,
  McpDefinition,
  mcpDefinitionSchema,
  Request,
  Resource,
  Manifest,
  Lock,
  ruleSchema,
  validName,
  VERSION,
} from '../core/model.js';
import { bundle, digest, exists, inside, readOptional, stable, textFile } from '../core/fs.js';
import { Workspace } from '../core/workspace.js';
import { apply, planUnits, Plan, readState, recover } from '../core/transaction.js';
import { discoverAgents, parseAgent } from '../providers/agents.js';
import { discoverSkills, skillMetadata } from '../providers/skills.js';
import { mcpArtifact, resolveDependency, restoreDependency } from '../providers/index.js';
import { parseResourceSource } from '../providers/source.js';
import { importHarnesses, importedResource, Imported } from '../harnesses/import.js';
import { profile, profiles } from '../harnesses/profiles.js';
import { render, RenderOptions, Unit } from '../harnesses/render.js';
import { inspectNative } from '../harnesses/inspect.js';
import {
  deduplicateResources,
  resourceIdentity,
  ruleIdentity,
  bundleIdentity,
} from '../core/dedup.js';
import { discoverRules, parseRule, canonicalRuleText } from '../providers/rules.js';
import { renderRules } from '../harnesses/rule-render.js';

function mcpDefinition(payload: Record<string, unknown>): McpDefinition {
  return mcpDefinitionSchema.parse({
    connection: payload.connection ?? payload,
    native: payload.native,
    format: payload.format,
  });
}
export async function resources(
  workspace: Workspace,
  options: {
    manifest?: Manifest;
    lock?: Lock;
    diagnostics?: Diagnostic[];
    deduplicate?: boolean;
  } = {},
): Promise<Resource[]> {
  const result: Resource[] = [],
    manifest = options.manifest ?? (await workspace.manifest()),
    lock = options.lock ?? (await workspace.lock());
  for (const [key, local] of Object.entries(manifest.skill)) {
    if (!local.path) throw new EtymonError('INVALID_MANIFEST', `Skill ${key} needs a path`);
    const path = resolve(workspace.agents, local.path);
    const artifact = await bundle(path);
    const metadata = skillMetadata(artifact);
    result.push({
      id: `skill:local/${key}`,
      kind: 'skill',
      name: local.name ?? String(metadata.name),
      files: artifact.files,
      metadata,
    });
  }
  for (const [key, local] of Object.entries(manifest.agent)) {
    if (!local.path) throw new EtymonError('INVALID_MANIFEST', `Agent ${key} needs a path`);
    const path = resolve(workspace.agents, local.path);
    const text = await fs.readFile(path, 'utf8');
    const agent: Agent =
      path.endsWith('.json') && JSON.parse(text).format
        ? agentSchema.parse(JSON.parse(text))
        : parseAgent(text, path);
    result.push({ id: `agent:local/${key}`, kind: 'agent', name: local.name ?? agent.name, agent });
  }
  for (const [key, local] of Object.entries(manifest.mcp)) {
    const definition = mcpDefinition(local);
    result.push({
      id: `mcp:local/${key}`,
      kind: 'mcp',
      name: local.name ?? key,
      ...definition,
    });
  }
  for (const [key, local] of Object.entries(manifest.rule)) {
    const path = resolve(workspace.agents, local.path);
    const rule = parseRule(await fs.readFile(path, 'utf8'), path);
    rule.base = local.destDir ?? rule.base;
    result.push({ id: `rule:local/${key}`, kind: 'rule', name: local.name ?? rule.name, rule });
  }
  for (const dependency of lock.dependencies) {
    const artifacts = await restoreDependency(dependency, workspace);
    for (const item of dependency.artifacts) {
      const artifact = artifacts.get(item.name)!;
      const id = `${dependency.id}/${item.name}`;
      if (dependency.kind === 'skill')
        result.push({
          id,
          kind: 'skill',
          name: item.name,
          files: artifact.files,
          metadata: skillMetadata(artifact),
        });
      else if (dependency.kind === 'agent') {
        const file = artifact.files[0];
        const agent = parseAgent(
          textFile(artifact, file.path),
          dependency.resolved.subpath ?? item.path,
        );
        result.push({ id, kind: 'agent', name: item.name, agent });
      } else if (dependency.kind === 'rule') {
        const file = artifact.files[0];
        const rule = ruleSchema.parse(JSON.parse(textFile(artifact, file.path)));
        result.push({ id, kind: 'rule', name: item.name, rule });
      } else
        result.push({
          id,
          kind: 'mcp',
          name: item.name,
          connection: connectionSchema.parse(mcpArtifact(artifact).connection),
        });
    }
  }
  for (const resource of result) {
    if (
      workspace.global &&
      resource.kind === 'rule' &&
      (resource.rule.base !== '.' ||
        resource.rule.activation !== 'always' ||
        Object.keys(resource.rule.native).length)
    )
      throw new EtymonError(
        'GLOBAL_RULE_SCOPE_UNSUPPORTED',
        'Global rules must be unscoped, always-on user guidance',
      );
    if (validName(resource.name) !== resource.name)
      throw new EtymonError(
        'INVALID_NAME',
        `Resource name ${resource.name} is not a safe native name`,
      );
  }
  return options.deduplicate === false ? result : deduplicateResources(result, options.diagnostics);
}
export async function add(
  workspace: Workspace,
  kind: Kind,
  request: Request,
): Promise<{ ids: string[]; names: string[] }> {
  const source = await parseResourceSource(
    kind,
    request.source,
    workspace.cwd,
    request.ref,
    workspace.home,
  );
  await workspace.init();
  if (source.type === 'local') {
    const manifest = await workspace.manifest();
    const ids: string[] = [],
      names: string[] = [];
    if (kind === 'mcp') {
      const name = validName(basename(source.path));
      const definition = mcpDefinition(JSON.parse(await fs.readFile(source.path, 'utf8')));
      const existing = manifest.mcp[name];
      if (existing && stable(mcpDefinition(existing)) !== stable(definition))
        throw new EtymonError(
          'LOCAL_NAME_COLLISION',
          `Local MCP ${name} already exists with different configuration; edit its entry in ${workspace.manifestPath}`,
        );
      manifest.mcp[name] = {
        ...definition,
        ...(existing?.origin ? { origin: existing.origin } : {}),
      };
      await workspace.saveManifest(manifest);
      return { ids: [`mcp:local/${name}`], names: [name] };
    }
    if (kind === 'rule')
      return registerRules(workspace, source.path, request.names, manifest, request.destDir);
    const locals =
      kind === 'skill'
        ? (await discoverSkills(source.path, request.names)).map((x) => ({
            path: x.path,
            name: x.name,
          }))
        : (await discoverAgents(source.path, request.names)).map((x) => ({
            path: x.path,
            name: x.agent.name,
          }));
    for (const local of locals) {
      if (
        manifest[kind][local.name] &&
        resolve(workspace.agents, manifest[kind][local.name].path ?? '') !== local.path
      ) {
        const priorPath = resolve(workspace.agents, manifest[kind][local.name].path);
        const equal =
          kind === 'skill'
            ? bundleIdentity(await bundle(priorPath)) === bundleIdentity(await bundle(local.path))
            : resourceIdentity({
                id: '',
                kind: 'agent',
                name: local.name,
                agent: parseAgent(await fs.readFile(priorPath, 'utf8'), priorPath),
              }) ===
              resourceIdentity({
                id: '',
                kind: 'agent',
                name: local.name,
                agent: parseAgent(await fs.readFile(local.path, 'utf8'), local.path),
              });
        if (!equal)
          throw new EtymonError(
            'LOCAL_NAME_COLLISION',
            `Local ${kind} ${local.name} already exists with different contents`,
          );
        ids.push(`${kind}:local/${local.name}`);
        names.push(local.name);
        continue;
      }
      manifest[kind][local.name] = {
        path: relative(workspace.agents, local.path).replaceAll('\\', '/'),
      };
      ids.push(`${kind}:local/${local.name}`);
      names.push(local.name);
    }
    await workspace.saveManifest(manifest);
    return { ids, names };
  }
  const dependency = await resolveDependency(kind, request, workspace),
    lock = await workspace.lock();
  const previous = lock.dependencies.find((d) => d.id === dependency.id);
  if (previous) {
    if (stable(previous) !== stable(dependency))
      throw new EtymonError(
        'DEPENDENCY_EXISTS',
        `${dependency.id} already exists with a different resolution; run update`,
      );
    return { ids: [dependency.id], names: dependency.artifacts.map((x) => x.name) };
  }
  const existingResources = await resources(workspace),
    proposed = await resources(workspace, {
      lock: { ...lock, dependencies: [...lock.dependencies, dependency] },
      deduplicate: false,
    });
  // Comparing resolved resources also catches local/external aliases; artifact
  // provenance and filename differences are not semantic content differences.
  const currentIds = new Set(existingResources.map((resource) => resource.id));
  const unique = deduplicateResources(proposed);
  if (unique.every((resource) => currentIds.has(resource.id)))
    return {
      ids: existingResources
        .filter(
          (resource) =>
            resource.kind === kind &&
            dependency.artifacts.some(
              (item) =>
                item.name === resource.name ||
                (resource.kind === 'rule' &&
                  proposed.some(
                    (value) =>
                      value.kind === 'rule' &&
                      value.id.startsWith(dependency.id + '/') &&
                      ruleIdentity(value.rule) === ruleIdentity(resource.rule),
                  )),
            ),
        )
        .map((resource) => resource.id),
      names: dependency.artifacts.map((item) => item.name),
    };
  lock.dependencies.push(dependency);
  await workspace.saveLock(lock);
  return { ids: [dependency.id], names: dependency.artifacts.map((x) => x.name) };
}
async function registerRules(
  workspace: Workspace,
  source: string,
  names: string[],
  manifest: Manifest,
  destDir?: string,
): Promise<{ ids: string[]; names: string[] }> {
  const locals = await discoverRules(source, names),
    environment = await resources(workspace),
    units: Unit[] = [],
    ids: string[] = [],
    registered: string[] = [];
  for (const local of locals) {
    const rule = ruleSchema.parse({ ...local.rule, base: destDir ?? local.rule.base }),
      name = rule.name;
    if (
      workspace.global &&
      (rule.base !== '.' || rule.activation !== 'always' || Object.keys(rule.native).length)
    )
      throw new EtymonError(
        'GLOBAL_RULE_SCOPE_UNSUPPORTED',
        'Global rules must be unscoped, always-on user guidance',
      );
    const duplicate = environment.find(
      (resource) => resource.kind === 'rule' && ruleIdentity(resource.rule) === ruleIdentity(rule),
    );
    if (duplicate) {
      if (duplicate.id.startsWith('rule:local/')) {
        const entry = manifest.rule[duplicate.id.slice('rule:local/'.length)];
        entry.origins = [
          ...new Set([...(entry.origins ?? (entry.origin ? [entry.origin] : [])), local.path]),
        ];
      }
      ids.push(duplicate.id);
      registered.push(duplicate.name);
      continue;
    }
    if (
      environment.some((resource) => resource.kind === 'rule' && resource.name === name) ||
      manifest.rule[name]
    )
      throw new EtymonError(
        'LOCAL_NAME_COLLISION',
        `Rule ${name} already exists with different contents or scope`,
      );
    const destination = join(workspace.agents, 'etymon', 'rules', name + '.md');
    const text = canonicalRuleText(rule),
      existing = await readOptional(destination);
    if (existing !== undefined && existing !== text)
      throw new EtymonError(
        'LOCAL_NAME_COLLISION',
        `Preserve authored source at ${destination} before registering another rule`,
      );
    const id = `rule:local/${name}`;
    units.push({
      path: destination,
      content: Buffer.from(text),
      resources: [id],
      harnesses: ['register'],
      mode: 0o600,
    });
    manifest.rule[name] = {
      path: relative(workspace.agents, destination).replaceAll('\\', '/'),
      origin: local.path,
      origins: [local.path],
      destDir: rule.base,
    };
    environment.push({ id, kind: 'rule', name, rule });
    ids.push(id);
    registered.push(name);
  }
  // Validate the entire source before committing any authored rule or registration.
  const plan = await planUnits(workspace, units, ['register'], { adopt: true });
  plan.state = await readState(workspace);
  plan.changes.push({
    path: workspace.manifestPath,
    before: (await exists(workspace.manifestPath))
      ? await fs.readFile(workspace.manifestPath)
      : undefined,
    after: Buffer.from(toml(manifest)),
    mode: 0o600,
  });
  await apply(workspace, plan);
  return { ids: [...new Set(ids)], names: [...new Set(registered)] };
}
export async function buildPlan(
  workspace: Workspace,
  targets: string[],
  options: RenderOptions & { adopt?: boolean; force?: boolean; locked?: boolean } = {},
): Promise<Plan> {
  const lock = await workspace.lock();
  if (
    options.locked &&
    (lock.toolchain.etymon !== VERSION || lock.toolchain.adapters !== ADAPTER_REVISION)
  )
    throw new EtymonError(
      'TOOLCHAIN_MISMATCH',
      'Locked build requires the exact etymon and adapter revision recorded in the lock',
    );
  const diagnostics: Diagnostic[] = [],
    environment = await resources(workspace, { diagnostics }),
    units: Unit[] = [];
  for (const target of targets) {
    const rendered = await render(environment, profile(target), workspace, options);
    units.push(...rendered.units);
    diagnostics.push(...rendered.diagnostics);
  }
  if (diagnostics.some((d) => d.severity === 'error'))
    return { changes: [], diagnostics, state: await readState(workspace), summary: [] };
  const plan = await planUnits(workspace, units, targets, options);
  plan.diagnostics.push(...diagnostics);
  return plan;
}
export async function sync(
  workspace: Workspace,
  targets: string[],
  options: RenderOptions & {
    adopt?: boolean;
    force?: boolean;
    dryRun?: boolean;
    locked?: boolean;
  } = {},
): Promise<Plan> {
  if (!options.dryRun) await recover(workspace);
  const plan = await buildPlan(workspace, targets, options);
  if (!options.dryRun) await apply(workspace, plan);
  return plan;
}
export async function convert(
  workspace: Workspace,
  target?: string | string[],
  options: { dryRun?: boolean; configPath?: string; rulesPath?: string } = {},
): Promise<{
  resources: { kind: string; name: string; origin: string; destination: string }[];
  diagnostics: Diagnostic[];
}> {
  const selected = target === undefined ? profiles.map((p) => p.id) : [target].flat();
  const ids = new Set(
    selected
      .flatMap((id) => id.split(','))
      .filter(Boolean)
      .map((id) => profile(id).id),
  );
  const imported = await importHarnesses(
      profiles.filter((p) => ids.has(p.id) && !(workspace.global && p.projectOnly)),
      workspace,
      options.configPath,
      options.rulesPath,
    ),
    manifest = await workspace.manifest();
  const existingResources = await resources(workspace);
  const changes: { resource: Imported; destination: string; key: string }[] = [];
  for (const resource of imported.resources) {
    if (
      workspace.global &&
      resource.kind === 'rule' &&
      (resource.rule.base !== '.' ||
        resource.rule.activation !== 'always' ||
        Object.keys(resource.rule.native).length)
    )
      throw new EtymonError(
        'GLOBAL_RULE_SCOPE_UNSUPPORTED',
        'Global rules must be unscoped, always-on user guidance',
      );
    let key = resource.name;
    if (resource.kind !== 'rule') {
      const normalized = importedResource(resource);
      const duplicate = existingResources.find(
        (value) =>
          value.kind === normalized.kind &&
          value.name === normalized.name &&
          resourceIdentity(value) === resourceIdentity(normalized),
      );
      if (duplicate?.id.startsWith(resource.kind + ':local/'))
        key = duplicate.id.slice((resource.kind + ':local/').length);
      else if (duplicate) {
        imported.diagnostics.push({
          code: 'RESOURCE_DUPLICATE',
          severity: 'info',
          message: `${resource.origin} is already locked as ${duplicate.id}; no duplicate authored resource created`,
        });
        continue;
      }
    }
    if (resource.kind === 'rule') {
      const duplicate = existingResources.find(
        (value) =>
          value.kind === 'rule' && ruleIdentity(value.rule) === ruleIdentity(resource.rule),
      );
      if (duplicate?.id.startsWith('rule:local/')) key = duplicate.id.slice('rule:local/'.length);
      else if (duplicate) {
        imported.diagnostics.push({
          code: 'RESOURCE_DUPLICATE',
          severity: 'info',
          message: `${resource.origin} is already locked as ${duplicate.id}; no duplicate authored rule created`,
        });
        continue;
      } else {
        const existing = manifest.rule[key];
        const origins = resource.origins ?? [resource.origin];
        if (
          existing?.origin &&
          !(existing.origins ?? [existing.origin]).some((origin) => origins.includes(origin))
        ) {
          key = validName(key.slice(0, 53) + '-' + ruleIdentity(resource.rule).slice(7, 15));
          resource.name = key;
          resource.rule = { ...resource.rule, name: key };
          resource.text = canonicalRuleText(resource.rule);
        }
      }
    }
    const existing = manifest[resource.kind][key];
    const destination =
      resource.kind === 'mcp'
        ? workspace.manifestPath
        : existing && 'path' in existing
          ? resolve(workspace.agents, existing.path)
          : join(
              workspace.agents,
              'etymon',
              resource.kind + 's',
              key + (resource.kind === 'skill' ? '' : resource.extension),
            );
    if (resource.kind === 'mcp') {
      const existingMcp = manifest.mcp[key];
      if (
        existingMcp &&
        ((existingMcp.name && existingMcp.name !== resource.name) ||
          resourceIdentity({ id: '', kind: 'mcp', name: key, ...mcpDefinition(existingMcp) }) !==
            resourceIdentity({ id: '', kind: 'mcp', name: key, ...resource.definition }))
      )
        throw new EtymonError(
          'IMPORT_CONFLICT',
          `Imported MCP differs in ${workspace.manifestPath} at mcp.${key}; preserve your edits before re-importing`,
        );
    } else if (await exists(destination)) {
      const identical =
        resource.kind === 'skill'
          ? bundleIdentity(await bundle(destination)) === bundleIdentity(resource.artifact)
          : resource.kind === 'rule'
            ? ruleIdentity({
                ...parseRule((await readOptional(destination))!, destination),
                ...(manifest.rule[key]?.destDir ? { base: manifest.rule[key].destDir } : {}),
              }) === ruleIdentity(resource.rule)
            : (await readOptional(destination)) === resource.text;
      if (!identical)
        throw new EtymonError(
          'IMPORT_CONFLICT',
          `Imported source differs at ${destination}; preserve your edits before re-importing`,
        );
    }
    if (existing && resource.kind !== 'mcp' && !(await exists(destination)))
      throw new EtymonError(
        'IMPORT_CONFLICT',
        `Existing authored ${resource.kind} ${key} has missing source at ${destination}; restore it before conversion`,
      );
    changes.push({ resource, destination, key });
  }
  if (!options.dryRun) {
    if (imported.diagnostics.some((d) => d.severity === 'error'))
      throw new EtymonError(
        'IMPORT_BLOCKED',
        'Resolve import diagnostics before converting',
        imported.diagnostics,
      );
    const units: Unit[] = [];
    for (const { resource, destination, key } of changes) {
      if (resource.kind === 'mcp') {
        manifest.mcp[key] = {
          ...(manifest.mcp[key] ? mcpDefinition(manifest.mcp[key]) : resource.definition),
          ...(manifest.mcp[key]?.name ? { name: manifest.mcp[key].name } : {}),
          origin: manifest.mcp[key]?.origin ?? resource.origin,
          origins: [
            ...new Set([
              ...(manifest.mcp[key]?.origins ?? []),
              ...(resource.origins ?? [resource.origin]),
            ]),
          ],
        };
        continue;
      }
      if (resource.kind === 'skill')
        for (const file of resource.artifact.files)
          units.push({
            path: inside(destination, file.path),
            content: Buffer.from(file.content, 'base64'),
            mode: file.executable ? 0o755 : 0o644,
            resources: [`${resource.kind}:local/${key}`],
            harnesses: ['import'],
          });
      else if (!(resource.kind === 'rule' && (await exists(destination))))
        units.push({
          path: destination,
          content: Buffer.from(resource.text!),
          mode: 0o600,
          resources: [`${resource.kind}:local/${key}`],
          harnesses: ['import'],
        });
      manifest[resource.kind][key] = {
        path: relative(workspace.agents, destination).replaceAll('\\', '/'),
        ...(manifest[resource.kind][key]?.name ? { name: manifest[resource.kind][key].name } : {}),
        origin: manifest[resource.kind][key]?.origin ?? resource.origin,
        origins: [
          ...new Set([
            ...(manifest[resource.kind][key]?.origins ?? []),
            ...(resource.origins ?? [resource.origin]),
          ]),
        ],
        ...(resource.kind === 'rule'
          ? { destDir: manifest.rule[key]?.destDir ?? resource.rule.base }
          : {}),
      };
    }
    // Import source is user owned. Use a transaction for atomic recovery, then remove import ownership.
    const prior = await readState(workspace);
    const plan = await planUnits(workspace, units, ['import'], { adopt: true });
    plan.state = prior;
    const before = (await exists(workspace.manifestPath))
      ? await fs.readFile(workspace.manifestPath)
      : undefined;
    plan.changes.push({
      path: workspace.manifestPath,
      before,
      after: Buffer.from(toml(manifest)),
      mode: 0o600,
    });
    await apply(workspace, plan);
    await workspace.init();
  }
  return {
    resources: changes.map(({ resource, destination }) => ({
      kind: resource.kind,
      name: resource.name,
      origin: resource.origin,
      destination,
    })),
    diagnostics: imported.diagnostics,
  };
}
export async function update(
  workspace: Workspace,
  selectors: string[] = [],
): Promise<{ updated: string[] }> {
  const lock = await workspace.lock(),
    updated: string[] = [];
  for (const selector of selectors)
    if (
      !lock.dependencies.some(
        (d) => d.id === selector || d.artifacts.some((a) => a.name === selector),
      )
    )
      throw new EtymonError('DEPENDENCY_NOT_FOUND', `No external dependency ${selector}`);
  const next = [];
  for (const dependency of lock.dependencies) {
    if (
      selectors.length &&
      !selectors.includes(dependency.id) &&
      !dependency.artifacts.some((a) => selectors.includes(a.name))
    ) {
      next.push(dependency);
      continue;
    }
    const refreshed = await resolveDependency(dependency.kind, dependency.request, workspace);
    next.push(refreshed);
    if (stable(dependency) !== stable(refreshed)) updated.push(dependency.id);
  }
  await resources(workspace, { lock: { ...lock, dependencies: next } });
  lock.dependencies = next;
  await workspace.saveLock(lock);
  return { updated };
}
export async function remove(
  workspace: Workspace,
  kind: Kind,
  selector: string,
  options: { dryRun?: boolean; allowLossy?: boolean } = {},
): Promise<{ removed: string; plan: Plan }> {
  const lock = await workspace.lock(),
    manifest = await workspace.manifest(),
    candidates: { id: string; type: 'external' | 'local'; key: string }[] = [];
  for (const dep of lock.dependencies)
    if (
      dep.kind === kind &&
      (dep.id === selector || dep.artifacts.some((a) => a.name === selector))
    )
      candidates.push({ id: dep.id, type: 'external', key: dep.id });
  for (const key of Object.keys(manifest[kind]))
    if (key === selector || `${kind}:local/${key}` === selector)
      candidates.push({ id: `${kind}:local/${key}`, type: 'local', key });
  if (candidates.length !== 1)
    throw new EtymonError(
      'REMOVE_SELECTION',
      `Expected one ${kind} matching ${selector}; found ${candidates.length}. Use its full ID.`,
    );
  const selected = candidates[0];
  if (selected.type === 'external')
    lock.dependencies = lock.dependencies.filter((d) => d.id !== selected.key);
  else delete manifest[kind][selected.key];
  const state = await readState(workspace);
  const keep = state.units.filter(
    (u) => !u.resources.some((id) => id === selected.id || id.startsWith(selected.id + '/')),
  );
  const units: Unit[] = [];
  const diagnostics: Diagnostic[] = [];
  // Reconstruct unchanged owned output for retention without re-rendering native differences.
  for (const owned of keep) {
    const bytes = await fs.readFile(owned.path);
    if (owned.key) {
      const { readDocument, entry } = await import('../core/documents.js');
      units.push({
        ...owned,
        value: entry(
          readDocument(bytes.toString('utf8'), owned.path.endsWith('.toml') ? 'toml' : 'json'),
          owned.key,
        ),
      });
    } else units.push({ ...owned, content: bytes });
  }
  if (kind === 'rule') {
    const remaining = await resources(workspace, { manifest, lock });
    const affected = state.units.filter((unit) => !keep.includes(unit));
    for (const target of state.targets) {
      const rendered = await renderRules(remaining, profile(target), workspace, options);
      if (rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
        throw new EtymonError(
          'REMOVE_BLOCKED',
          'Remaining rule output cannot be rendered safely',
          rendered.diagnostics,
        );
      diagnostics.push(...rendered.diagnostics);
      units.push(
        ...rendered.units.filter((unit) =>
          affected.some(
            (owned) => owned.path === unit.path && stable(owned.key) === stable(unit.key),
          ),
        ),
      );
    }
    // Loader settings can also contain the user's instruction filenames. Keep
    // their current values when the last rule is removed, then release ownership.
    for (const owned of affected.filter(
      (unit) => unit.key && (unit.key[0] === 'context' || unit.key[0] === 'instructions'),
    )) {
      if (units.some((unit) => unit.path === owned.path && stable(unit.key) === stable(owned.key)))
        continue;
      const { readDocument, entry } = await import('../core/documents.js');
      units.push({
        ...owned,
        resources: [],
        value: entry(readDocument(await fs.readFile(owned.path, 'utf8'), 'json'), owned.key!),
      });
    }
  }
  const plan = await planUnits(workspace, units, state.targets);
  plan.diagnostics.push(...diagnostics);
  plan.state.units = plan.state.units.filter((unit) => unit.resources.length > 0);
  const path = selected.type === 'external' ? workspace.lockPath : workspace.manifestPath;
  plan.changes.push({
    path,
    before: await fs.readFile(path),
    after: Buffer.from(selected.type === 'external' ? json(lock) : toml(manifest)),
    mode: 0o600,
  });
  if (!options.dryRun) await apply(workspace, plan);
  return { removed: selected.id, plan };
}
export async function doctor(
  workspace: Workspace,
  targets: string[],
  options: RenderOptions = {},
): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const state = await readState(workspace);
  if (await exists(workspace.runtime + '/journal.json'))
    diagnostics.push({
      code: 'INTERRUPTED_TRANSACTION',
      severity: 'error',
      message: 'An interrupted transaction exists; run etymon recover before another mutation',
    });
  for (const owned of state.units) {
    const bytes = (await exists(owned.path)) ? await fs.readFile(owned.path) : undefined;
    if (!bytes) {
      diagnostics.push({
        code: 'MISSING_OUTPUT',
        severity: 'error',
        message: `Missing ${owned.path}`,
      });
      continue;
    }
    let hash = digest(bytes);
    if (owned.key) {
      const { readDocument, entry } = await import('../core/documents.js');
      const value = entry(
        readDocument(bytes.toString('utf8'), owned.path.endsWith('.toml') ? 'toml' : 'json'),
        owned.key,
      );
      hash = digest(stable(value));
    }
    if (hash !== owned.digest)
      diagnostics.push({
        code: 'MANAGED_DRIFT',
        severity: 'error',
        message: `Edited managed output: ${owned.path}`,
      });
  }
  try {
    const environment = await resources(workspace, { diagnostics });
    for (const resource of environment)
      if (resource.kind === 'mcp') {
        const connection = resource.connection;
        const values =
          connection.transport === 'stdio'
            ? [...connection.args, ...Object.values(connection.env)]
            : Object.values(connection.headers);
        const variables = new Set(
          values.flatMap((value) =>
            typeof value === 'object'
              ? [value.env]
              : [...value.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]),
          ),
        );
        for (const variable of variables)
          if (process.env[variable] === undefined)
            diagnostics.push({
              code: 'MISSING_ENVIRONMENT',
              severity: 'warning',
              message: `${resource.name} needs environment variable ${variable}`,
              resource: resource.id,
            });
      }
    for (const target of targets) {
      diagnostics.push(
        ...(await render(environment, profile(target), workspace, options)).diagnostics,
      );
      diagnostics.push(...(await inspectNative(profile(target), workspace, environment)));
    }
  } catch (e) {
    diagnostics.push({
      code: e instanceof EtymonError ? e.code : 'INVALID_ENVIRONMENT',
      severity: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
}
