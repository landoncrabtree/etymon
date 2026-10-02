import { z } from 'zod';
import { EtymonError } from './model.js';

/** Source dialects, not a fifth resource kind. Commands resolve to skills. */
export const commandFormats = [
  'markdown',
  'claude',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'opencode',
  'kilo',
  'amp',
  'roo',
  'cline',
  'windsurf',
  'antigravity',
  'pi',
  'omp',
  'kiro',
  'continue',
] as const;
export const commandFormatSchema = z.enum(commandFormats);
export type CommandFormat = z.infer<typeof commandFormatSchema>;
export const invocationSchema = z.enum(['auto', 'manual', 'model', 'never']);
export type Invocation = z.infer<typeof invocationSchema>;
export const commandSemanticsSchema = z
  .object({
    version: z.literal(1),
    format: commandFormatSchema,
    native: z.record(z.string(), z.unknown()).default({}),
    features: z.array(z.enum(['arguments', 'context', 'execution', 'workflow'])).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of [
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'disable-model-invocation',
      'user-invocable',
      'argument-hint',
      '__proto__',
      'constructor',
      'prototype',
    ])
      if (Object.hasOwn(value.native, key))
        context.addIssue({
          code: 'custom',
          message: `Reserved command native field ${key}`,
          path: ['native', key],
        });
  });
export type CommandSemantics = z.infer<typeof commandSemanticsSchema>;
export type SkillPolicy = {
  invocation?: Invocation;
  argumentHint?: string;
  command?: CommandSemantics;
};

export function skillPolicy(metadata: Record<string, unknown>): SkillPolicy {
  const values = metadata.metadata;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const record = values as Record<string, unknown>;
  const result: SkillPolicy = {};
  try {
    if (record['etymon.invocation'] !== undefined)
      result.invocation = invocationSchema.parse(record['etymon.invocation']);
    if (record['etymon.argument-hint'] !== undefined)
      result.argumentHint = z.string().parse(record['etymon.argument-hint']);
    if (record['etymon.command'] !== undefined)
      result.command = commandSemanticsSchema.parse(
        JSON.parse(z.string().parse(record['etymon.command'])),
      );
    if (result.invocation) {
      const disabled = result.invocation === 'manual' || result.invocation === 'never';
      const user = result.invocation !== 'model' && result.invocation !== 'never';
      if (
        (metadata['disable-model-invocation'] !== undefined &&
          metadata['disable-model-invocation'] !== disabled) ||
        (metadata['user-invocable'] !== undefined && metadata['user-invocable'] !== user)
      )
        throw new Error('Conflicting invocation controls');
    }
  } catch {
    throw new EtymonError('INVALID_SKILL', 'Invalid reserved Etymon skill metadata');
  }
  return result;
}
