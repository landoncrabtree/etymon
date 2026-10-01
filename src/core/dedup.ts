import { Diagnostic, EtymonError, Resource, Rule, Artifact } from './model.js';
import { digest, stable } from './fs.js';

/** Normalize line endings and final newlines, preserving indentation and code. */
export function normalizedText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replace(/\n+$/, '');
}
export function ruleIdentity(rule: Rule): string {
  const patterns = rule.patterns.map((pattern) => {
    const negative = pattern.startsWith('!'),
      value = (negative ? pattern.slice(1) : pattern).replace(/^\.\//, '');
    return (negative ? '!' : '') + (rule.base === '.' ? '' : rule.base + '/') + value;
  });
  return digest(
    stable({
      prompt: normalizedText(rule.prompt),
      base: rule.activation === 'glob' ? '.' : rule.base,
      activation: rule.activation,
      patterns: patterns.some((pattern) => pattern.startsWith('!'))
        ? patterns
        : [...new Set(patterns)].sort(),
      // A description changes activation only for model-selected rules.
      ...(['model', 'native'].includes(rule.activation) ? { description: rule.description } : {}),
      ...(Object.keys(rule.native).length ? { format: rule.format, native: rule.native } : {}),
    }),
  );
}
export function bundleIdentity(artifact: Artifact): string {
  return digest(
    stable(
      [...artifact.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => ({
          ...file,
          content:
            file.path === 'SKILL.md'
              ? Buffer.from(
                  normalizedText(Buffer.from(file.content, 'base64').toString('utf8')),
                ).toString('base64')
              : file.content,
        })),
    ),
  );
}
export function resourceIdentity(resource: Resource): string {
  switch (resource.kind) {
    case 'rule':
      return ruleIdentity(resource.rule);
    case 'skill':
      return bundleIdentity({ version: 1, files: resource.files });
    case 'agent':
      return digest(stable({ ...resource.agent, prompt: normalizedText(resource.agent.prompt) }));
    case 'mcp':
      return digest(
        stable({
          connection: resource.connection,
          native: resource.native ?? {},
          ...(Object.keys(resource.native ?? {}).length ? { format: resource.format } : {}),
        }),
      );
  }
}
/** Names identify executable resources; rules additionally identify by content + scope. */
export function deduplicateResources(
  input: Resource[],
  diagnostics: Diagnostic[] = [],
): Resource[] {
  const names = new Map<string, Resource>(),
    identities = new Map<string, Resource>(),
    result: Resource[] = [];
  for (const resource of input) {
    const key = resource.kind + ':' + resource.name,
      hash = resourceIdentity(resource);
    const named = names.get(key);
    if (named && resourceIdentity(named) !== hash)
      throw new EtymonError(
        'RESOURCE_NAME_COLLISION',
        `Different definitions allocate ${key}; rename one or remove the conflicting source`,
      );
    const prior = named ?? (resource.kind === 'rule' ? identities.get('rule:' + hash) : undefined);
    names.set(key, resource);
    if (prior) {
      diagnostics.push({
        code: 'RESOURCE_DUPLICATE',
        severity: 'info',
        resource: resource.id,
        message: `${resource.id} is equivalent to ${prior.id}; one ${resource.kind} will be activated`,
      });
      continue;
    }
    identities.set(resource.kind + ':' + hash, resource);
    result.push(resource);
  }
  return result;
}
