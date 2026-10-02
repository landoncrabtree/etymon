import { z } from 'zod';
import { commandFormats } from './commands.js';
import { readFileSync } from 'node:fs';

export const VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
export const ADAPTER_REVISION = '2026-10-02.2';
export const SKILLS_VERSION = '1.7.0';
export const kinds = ['skill', 'mcp', 'agent', 'rule'] as const;
export type Kind = (typeof kinds)[number];
export type Diagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  resource?: string;
  harness?: string;
};
export class EtymonError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'EtymonError';
  }
}
export const valueSchema = z.union([
  z.string(),
  z.object({ env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }).strict(),
]);
export type Value = z.infer<typeof valueSchema>;
export const connectionSchema = z.discriminatedUnion('transport', [
  z
    .object({
      transport: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(valueSchema).default([]),
      env: z.record(z.string(), valueSchema).default({}),
      cwd: z.string().optional(),
    })
    .strict(),
  z
    .object({
      transport: z.enum(['streamable-http', 'sse']),
      url: z.string().url(),
      headers: z.record(z.string(), valueSchema).default({}),
    })
    .strict(),
]);
export type Connection = z.infer<typeof connectionSchema>;
export const mcpDefinitionSchema = z
  .object({
    connection: connectionSchema,
    native: z.record(z.string(), z.unknown()).default({}),
    format: z.string().optional(),
  })
  .strict();
export type McpDefinition = z.infer<typeof mcpDefinitionSchema>;
export const agentSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    description: z.string().min(1),
    prompt: z.string().min(1),
    format: z.string(),
    tools: z.array(z.string()).optional(),
    model: z.string().optional(),
    native: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Agent = z.infer<typeof agentSchema>;
// Activation is separate from directory scope. A target may broaden either only
// when explicitly requested through lossy conversion; canonical source stays intact.
const directorySchema = z
  .string()
  .refine(
    (value) =>
      value === '.' ||
      (/^[^/\\]+(?:\/[^/\\]+)*$/.test(value) &&
        !value.split('/').some((part) => part === '.' || part === '..') &&
        !/[\x00-\x1f:*?\[\]{}]/.test(value)),
    'Rule base must be a relative directory without traversal or glob characters',
  );
export const ruleSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    prompt: z.string().min(1),
    base: directorySchema.default('.'),
    layout: z.enum(['standing', 'modular']).default('standing'),
    activation: z.enum(['always', 'glob', 'model', 'manual', 'never', 'native']).default('always'),
    patterns: z.array(z.string().min(1)).default([]),
    description: z.string().optional(),
    format: z.string().default('etymon'),
    native: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.activation === 'glob' && !rule.patterns.length)
      ctx.addIssue({ code: 'custom', message: 'Glob rules require patterns' });
    if (rule.activation === 'model' && !rule.description?.trim())
      ctx.addIssue({ code: 'custom', message: 'Model-selected rules require a description' });
    if (!['glob', 'native'].includes(rule.activation) && rule.patterns.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Only glob or native conditions may specify patterns',
      });
    for (const pattern of rule.patterns) {
      const value = pattern.replace(/^!/, '');
      if (
        !value ||
        value.startsWith('/') ||
        /^[A-Za-z]:/.test(value) ||
        value.split(/[\\/]/).includes('..') ||
        /[\x00-\x1f\\]/.test(value)
      )
        ctx.addIssue({ code: 'custom', message: `Unsafe rule pattern: ${pattern}` });
    }
  });
export type Rule = z.infer<typeof ruleSchema>;
export type Resource =
  | {
      id: string;
      kind: 'skill';
      name: string;
      files: ArtifactFile[];
      metadata: Record<string, unknown>;
    }
  | { id: string; kind: 'agent'; name: string; agent: Agent }
  | { id: string; kind: 'rule'; name: string; rule: Rule }
  | {
      id: string;
      kind: 'mcp';
      name: string;
      connection: Connection;
      native?: Record<string, unknown>;
      format?: string;
    };
export const fileSchema = z
  .object({ path: z.string(), content: z.string(), executable: z.boolean().default(false) })
  .strict();
export type ArtifactFile = z.infer<typeof fileSchema>;
export const artifactSchema = z
  .object({ version: z.literal(1), files: z.array(fileSchema) })
  .strict();
export type Artifact = z.infer<typeof artifactSchema>;
export const requestSchema = z
  .object({
    source: z.string(),
    commandFormat: z.enum(['auto', ...commandFormats]).optional(),
    names: z.array(z.string()).default([]),
    destDir: directorySchema.optional(),
    ref: z.string().optional(),
    version: z.string().optional(),
    registry: z.string().optional(),
    package: z.string().optional(),
    remote: z.number().int().nonnegative().optional(),
    inputs: z.record(z.string(), valueSchema).optional(),
  })
  .strict();
export type Request = z.infer<typeof requestSchema>;
export const dependencySchema = z
  .object({
    id: z.string(),
    kind: z.enum(kinds),
    request: requestSchema,
    resolved: z
      .object({
        provider: z.enum(['git', 'url', 'mcp-registry']),
        repository: z.string().optional(),
        commit: z
          .string()
          .regex(/^[a-f0-9]{40,64}$/)
          .optional(),
        subpath: z.string().optional(),
        version: z.string().optional(),
        registry: z.string().optional(),
        skillsCli: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    artifacts: z.array(
      z
        .object({
          name: z.string(),
          digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          path: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type Dependency = z.infer<typeof dependencySchema>;
export const lockSchema = z
  .object({
    version: z.literal(1),
    toolchain: z
      .object({
        etymon: z.string(),
        adapters: z.string(),
        skills: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
      })
      .strict(),
    dependencies: z.array(dependencySchema),
  })
  .strict();
export type Lock = z.infer<typeof lockSchema>;
export const localSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().optional(),
    origin: z.string().optional(),
    origins: z.array(z.string()).optional(),
  })
  .strict();
export type Local = z.infer<typeof localSchema>;
export const localRuleSchema = localSchema.extend({ destDir: directorySchema.optional() }).strict();
export const localMcpSchema = mcpDefinitionSchema
  .extend({
    name: z.string().optional(),
    origin: z.string().optional(),
    origins: z.array(z.string()).optional(),
  })
  .strict();
export const manifestSchema = z
  .object({
    version: z.literal(1),
    skill: z.record(z.string(), localSchema).default({}),
    agent: z.record(z.string(), localSchema).default({}),
    rule: z.record(z.string(), localRuleSchema).default({}),
    mcp: z.record(z.string(), localMcpSchema).default({}),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function emptyLock(): Lock {
  return {
    version: 1,
    toolchain: { etymon: VERSION, adapters: ADAPTER_REVISION, skills: SKILLS_VERSION },
    dependencies: [],
  };
}
export function emptyManifest(): Manifest {
  return { version: 1, skill: {}, agent: {}, rule: {}, mcp: {} };
}
export function validName(input: string): string {
  const name = input
    .toLowerCase()
    .replace(/\.(agent\.)?(md|toml|json|yaml|yml)$/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!name || !/^[a-z0-9]/.test(name))
    throw new EtymonError('INVALID_NAME', `Cannot derive a safe name from ${input}`);
  return name;
}
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}
export function envName(value: Value): string | undefined {
  return typeof value === 'object' ? value.env : undefined;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
