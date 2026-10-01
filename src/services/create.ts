import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { stringify as yaml } from 'yaml';
import { stringify as toml } from 'smol-toml';
import { z } from 'zod';
import {
  agentSchema,
  connectionSchema,
  EtymonError,
  json,
  Kind,
  manifestSchema,
  Resource,
  ruleSchema,
  Value,
} from '../core/model.js';
import { exists, noSymlink, fileArtifact } from '../core/fs.js';
import { Workspace } from '../core/workspace.js';
import { apply, planUnits, readState } from '../core/transaction.js';
import { skillMetadata } from '../providers/skills.js';
import { canonicalRuleText } from '../providers/rules.js';
import { resources } from './environment.js';
import { Unit } from '../harnesses/render.js';
import { ruleIdentity } from '../core/dedup.js';

const name = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const body = z.string().refine((value) => Boolean(value.trim()), 'Body is required');
const description = z.string().trim().min(1);
export const creationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('skill'),
      name: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: description.max(1024),
      body,
      license: z.string().optional(),
      compatibility: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('agent'),
      name,
      description,
      body,
      model: z.string().optional(),
      tools: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('mcp'), name, connection: connectionSchema }).strict(),
  z
    .object({
      kind: z.literal('rule'),
      name,
      body,
      description: z.string().optional(),
      destDir: z.string().optional(),
      layout: ruleSchema.shape.layout.optional(),
      activation: z.enum(['always', 'glob', 'model', 'manual', 'never']).optional(),
      patterns: z.array(z.string()).optional(),
    })
    .strict()
    .superRefine((draft, ctx) => {
      const parsed = ruleSchema.safeParse({
        name: draft.name,
        prompt: draft.body,
        description: draft.description,
        base: draft.destDir,
        layout: draft.layout,
        activation: draft.activation,
        patterns: draft.patterns,
      });
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }),
]);
export type Creation = z.infer<typeof creationSchema>;
export type CreationDraft = {
  name?: string;
  description?: string;
  body?: string;
  license?: string;
  compatibility?: string;
  model?: string;
  tools?: string[];
  connection?: z.infer<typeof connectionSchema>;
  destDir?: string;
  layout?: z.infer<typeof ruleSchema>['layout'];
  activation?: z.infer<typeof ruleSchema>['activation'];
  patterns?: string[];
};
export type CreateResult = { ids: string[]; names: string[]; path: string; kind: Kind };

export function creationValues(items: string[]): Record<string, Value> {
  const result: Record<string, Value> = {};
  for (const item of items) {
    const split = item.indexOf('=');
    const key = item.slice(0, split).trim();
    if (split < 1 || !key)
      throw new EtymonError('INVALID_INPUT', 'Use NAME=value or NAME=env:VARIABLE');
    if (Object.hasOwn(result, key))
      throw new EtymonError('DUPLICATE_INPUT', `Duplicate input ${key}`);
    const value = item.slice(split + 1);
    result[key] = value.startsWith('env:') ? { env: value.slice(4) } : value;
  }
  return result;
}

/** Author a resource directly in its final source location, in one transaction. */
export async function create(workspace: Workspace, input: unknown): Promise<CreateResult> {
  const parsed = creationSchema.safeParse(input);
  if (!parsed.success) throw new EtymonError('INVALID_CREATION', parsed.error.message);
  const draft = parsed.data,
    kind = draft.kind,
    id = `${kind}:local/${draft.name}`;
  let destination = workspace.manifestPath;
  let text: string | undefined;
  let candidate: Resource;
  if (draft.kind === 'skill') {
    const metadata = {
      name: draft.name,
      description: draft.description,
      ...(draft.license ? { license: draft.license } : {}),
      ...(draft.compatibility ? { compatibility: draft.compatibility } : {}),
    };
    text = `---\n${yaml(metadata)}---\n\n${draft.body}\n`;
    const artifact = fileArtifact('SKILL.md', text);
    candidate = {
      id,
      kind,
      name: draft.name,
      files: artifact.files,
      metadata: skillMetadata(artifact),
    } as Resource;
    destination = join(workspace.agents, 'etymon/skills', draft.name, 'SKILL.md');
  } else if (draft.kind === 'agent') {
    const agent = agentSchema.parse({
      name: draft.name,
      description: draft.description,
      prompt: draft.body,
      model: draft.model,
      tools: draft.tools,
      format: 'etymon',
    });
    text = json(agent);
    candidate = { id, kind: 'agent', name: draft.name, agent };
    destination = join(workspace.agents, 'etymon/agents', draft.name + '.json');
  } else if (draft.kind === 'rule') {
    const rule = ruleSchema.parse({
      name: draft.name,
      prompt: draft.body,
      description: draft.description,
      base: draft.destDir,
      layout: draft.layout,
      activation: draft.activation,
      patterns: draft.patterns,
    });
    if (workspace.global && (rule.base !== '.' || rule.activation !== 'always'))
      throw new EtymonError(
        'GLOBAL_RULE_SCOPE_UNSUPPORTED',
        'Global rules must be unscoped, always-on user guidance',
      );
    text = canonicalRuleText(rule);
    candidate = { id, kind: 'rule', name: draft.name, rule };
    destination = join(workspace.agents, 'etymon/rules', draft.name + '.md');
  } else
    candidate = {
      id,
      kind: 'mcp',
      name: draft.name,
      connection: draft.connection,
      native: {},
      format: 'etymon',
    };

  const environment = await resources(workspace);
  if (environment.some((resource) => resource.kind === kind && resource.name === draft.name))
    throw new EtymonError('LOCAL_NAME_COLLISION', `${kind} ${draft.name} already exists`);
  if (candidate.kind === 'rule') {
    const duplicate = environment.find(
      (resource) =>
        resource.kind === 'rule' && ruleIdentity(resource.rule) === ruleIdentity(candidate.rule),
    );
    if (duplicate)
      return { ids: [duplicate.id], names: [duplicate.name], path: workspace.manifestPath, kind };
  }
  if (text !== undefined) {
    await noSymlink(destination, workspace.root);
    if (await exists(destination))
      throw new EtymonError(
        'LOCAL_NAME_COLLISION',
        `Authored source already exists at ${destination}`,
      );
  }
  await workspace.init();
  const manifest = await workspace.manifest();
  if (candidate.kind === 'mcp')
    manifest.mcp[draft.name] = { connection: candidate.connection, native: {}, format: 'etymon' };
  else {
    const source = candidate.kind === 'skill' ? join(destination, '..') : destination;
    manifest[candidate.kind][draft.name] = {
      path: relative(workspace.agents, source).replaceAll('\\', '/'),
      ...(candidate.kind === 'rule' ? { destDir: candidate.rule.base } : {}),
    };
  }
  const units: Unit[] =
    text === undefined
      ? []
      : [
          {
            path: destination,
            content: Buffer.from(text),
            resources: [id],
            harnesses: ['create'],
            mode: 0o600,
          },
        ];
  const plan = await planUnits(workspace, units, ['create']);
  plan.state = await readState(workspace);
  plan.changes.push({
    path: workspace.manifestPath,
    before: await fs.readFile(workspace.manifestPath),
    after: Buffer.from(toml(manifestSchema.parse(manifest))),
    mode: 0o600,
  });
  await apply(workspace, plan);
  return { ids: [id], names: [draft.name], path: destination, kind };
}
