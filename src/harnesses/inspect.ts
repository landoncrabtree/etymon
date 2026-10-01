import { join } from 'node:path';
import { Diagnostic, Resource } from '../core/model.js';
import { exists, readOptional } from '../core/fs.js';
import { readDocument } from '../core/documents.js';
import { Workspace } from '../core/workspace.js';
import { location, Profile } from './profiles.js';
import { readLocations } from './discovery.js';
import { bundle } from '../core/fs.js';
import { bundleIdentity } from '../core/dedup.js';
import { importRules } from './rule-import.js';

/** Read known compatibility locations; never use them as fallback write destinations. */
export async function inspectNative(
  p: Profile,
  workspace: Workspace,
  resources: Resource[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  if (!workspace.global && p.id === 'copilot-cli') {
    if (!(await exists(join(workspace.root, '.git'))))
      diagnostics.push({
        code: 'GIT_REPOSITORY_REQUIRED',
        severity: 'warning',
        message: 'Copilot project MCP discovery requires a Git repository.',
        harness: p.id,
      });
    const root = await readOptional(join(workspace.root, '.mcp.json'));
    const project = await readOptional(join(workspace.root, '.github/mcp.json'));
    if (root && project) {
      const high = readDocument(root, 'json'),
        low = readDocument(project, 'json');
      const highMap = (high.mcpServers ?? high) as Record<string, unknown>,
        lowMap = (low.mcpServers ?? low) as Record<string, unknown>;
      for (const name of Object.keys(lowMap))
        if (name in highMap)
          diagnostics.push({
            code: 'NATIVE_SHADOWING',
            severity: 'warning',
            message: `${name} in .github/mcp.json is shadowed by the root .mcp.json definition for Copilot CLI.`,
            harness: p.id,
          });
    }
  }
  const preferred = location(p, 'skill', workspace);
  for (const resource of resources.filter((r) => r.kind === 'skill')) {
    for (const root of readLocations(p, 'skill', workspace)) {
      if (root === preferred) continue;
      const path = join(root, resource.name, 'SKILL.md');
      if (await exists(path)) {
        const identical =
          resource.kind === 'skill' &&
          bundleIdentity(await bundle(join(root, resource.name))) ===
            bundleIdentity({ version: 1, files: resource.files });
        diagnostics.push({
          code: identical ? 'RESOURCE_DUPLICATE' : 'COMPATIBILITY_ALIAS',
          severity: identical ? 'info' : 'warning',
          message: identical
            ? `${path} is an equivalent skill bundle; Etymon activates one definition`
            : `${p.label} can also discover ${resource.name} at ${path} with different content; review native precedence.`,
          harness: p.id,
          resource: resource.id,
        });
      }
    }
    if (!workspace.global) {
      const personal = new Workspace({
        global: true,
        ...(workspace.homeOverride ? { home: workspace.home } : {}),
      });
      const personalRoot = location(p, 'skill', personal);
      if (personalRoot && (await exists(join(personalRoot, resource.name, 'SKILL.md'))))
        diagnostics.push({
          code: 'SCOPE_COLLISION',
          severity: 'warning',
          message: `Personal ${resource.name} also exists for ${p.label}; native user/project precedence applies.`,
          harness: p.id,
          resource: resource.id,
        });
    }
  }
  if (resources.some((resource) => resource.kind === 'rule')) {
    const report = await importRules(p, workspace);
    diagnostics.push(
      ...report.diagnostics.filter((diagnostic) =>
        [
          'RESOURCE_DUPLICATE',
          'NATIVE_SHADOWING',
          'RULE_INCLUDE_BRIDGE',
          'RULE_SYMLINK_SKIPPED',
        ].includes(diagnostic.code),
      ),
    );
  }
  return diagnostics;
}
