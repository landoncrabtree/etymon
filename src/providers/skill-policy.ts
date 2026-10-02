import { stringify as yaml } from 'yaml';
import { Artifact } from '../core/model.js';
import { fileArtifact, stable, textFile } from '../core/fs.js';
import { SkillPolicy, skillPolicy } from '../core/commands.js';
import { frontmatter } from './agents.js';

export function policyMetadata(policy: SkillPolicy): Record<string, string> {
  return {
    ...(policy.invocation ? { 'etymon.invocation': policy.invocation } : {}),
    ...(policy.argumentHint ? { 'etymon.argument-hint': policy.argumentHint } : {}),
    ...(policy.command ? { 'etymon.command': stable(policy.command) } : {}),
  };
}

/** Codex's policy is an ordinary supporting file in the authoritative bundle. */
export function invocationFiles(policy: SkillPolicy): Artifact['files'] {
  return policy.invocation === 'manual' || policy.invocation === 'never'
    ? fileArtifact('agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n').files
    : [];
}

export function skillText(metadata: Record<string, unknown>, body: string): string {
  return `---\n${yaml(metadata, { lineWidth: 0 })}---\n\n${body}\n`;
}

export function rewriteSkillMetadata(text: string, metadata: Record<string, unknown>): string {
  const body = text.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, '');
  return `---\n${yaml(metadata, { lineWidth: 0 })}---\n${body}`;
}

/** Strip only an exact native projection of marked canonical metadata. */
export function normalizeSkillProjection(artifact: Artifact): Artifact {
  const text = textFile(artifact, 'SKILL.md');
  const parsed = frontmatter(text);
  const policy = skillPolicy(parsed.metadata);
  if (!policy.invocation) return artifact;
  const metadata = { ...parsed.metadata };
  const disabled = policy.invocation === 'manual' || policy.invocation === 'never';
  const user = policy.invocation !== 'model' && policy.invocation !== 'never';
  if (metadata['disable-model-invocation'] === disabled)
    delete metadata['disable-model-invocation'];
  if (metadata['user-invocable'] === user) delete metadata['user-invocable'];
  if (metadata['argument-hint'] === policy.argumentHint) delete metadata['argument-hint'];
  for (const [key, value] of Object.entries(policy.command?.native ?? {}))
    if (stable(metadata[key]) === stable(value)) delete metadata[key];
  if (stable(metadata) === stable(parsed.metadata)) return artifact;
  const content = Buffer.from(rewriteSkillMetadata(text, metadata)).toString('base64');
  return {
    ...artifact,
    files: artifact.files.map((file) => (file.path === 'SKILL.md' ? { ...file, content } : file)),
  };
}
