import { parseDocument, stringify as yaml } from 'yaml';
import { Artifact, Diagnostic, EtymonError, Resource } from '../core/model.js';
import { skillPolicy } from '../core/commands.js';
import { fileArtifact, textFile } from '../core/fs.js';
import { rewriteSkillMetadata } from '../providers/skill-policy.js';
import type { Profile } from './profiles.js';
import { skillControls } from './skill-profiles.js';

const standard = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
const manualControls = new Set(
  Object.entries(skillControls)
    .filter(([, controls]) => controls.manual === 'frontmatter')
    .map(([id]) => id),
);
const userControls = new Set(
  Object.entries(skillControls)
    .filter(([, controls]) => controls.userHidden)
    .map(([id]) => id),
);
const hintControls = new Set(
  Object.entries(skillControls)
    .filter(([, controls]) => controls.hint)
    .map(([id]) => id),
);

export function renderSkill(
  resource: Extract<Resource, { kind: 'skill' }>,
  p: Profile,
  options: { allowLossy?: boolean },
): { artifact: Artifact; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const policy = skillPolicy(resource.metadata);
  const metadata = { ...resource.metadata };
  let changed = false;
  const loss = (code: string, message: string) => {
    if (!options.allowLossy)
      throw new EtymonError(code, message + '; use --allow-lossy to accept this change');
    diagnostics.push({
      code:
        code === 'SKILL_EXTENSION_BLOCKED'
          ? 'SKILL_FIELDS_OMITTED'
          : code.replace(/UNSUPPORTED|BLOCKED/, 'OMITTED'),
      severity: 'warning',
      message,
      resource: resource.id,
      harness: p.id,
    });
  };
  // Native controls are understood individually; unknown extensions remain native requirements.
  const invocation =
    policy.invocation ?? (metadata['disable-model-invocation'] === true ? 'manual' : undefined);
  if (invocation === 'manual' || invocation === 'never') {
    if (manualControls.has(p.id) || p.id === 'codex') {
      // Codex enforces the sidecar below. Retaining the frontmatter control
      // also lets Zed consume the same shared .agents/skills bundle.
      metadata['disable-model-invocation'] = true;
      changed = true;
    } else if (p.id !== 'codex')
      loss(
        'SKILL_INVOCATION_UNSUPPORTED',
        `Skill ${resource.name}: ${p.id} cannot enforce manual-only invocation; the model may select it automatically`,
      );
  }
  if (invocation === 'model' || invocation === 'never') {
    if (userControls.has(p.id)) {
      metadata['user-invocable'] = false;
      changed = true;
    } else
      loss(
        'SKILL_INVOCATION_UNSUPPORTED',
        `Skill ${resource.name}: ${p.id} cannot hide explicit invocation; users may invoke this skill`,
      );
  }
  if (policy.argumentHint) {
    if (hintControls.has(p.id)) {
      metadata['argument-hint'] = policy.argumentHint;
      changed = true;
    } else
      loss(
        'SKILL_COMMAND_FIELDS_UNSUPPORTED',
        `Skill ${resource.name}: ${p.id} omits command argument autocomplete hint ${JSON.stringify(policy.argumentHint)}`,
      );
  }
  if (policy.command) {
    const { format, native, features } = policy.command;
    const claude = ['claude', 'copilot'].includes(format) && p.id === 'claude';
    if (
      features.length &&
      !(claude && features.every((feature) => ['arguments', 'context'].includes(feature)))
    )
      loss(
        'COMMAND_TEMPLATE_UNSUPPORTED',
        `Skill ${resource.name}: ${p.id} cannot reproduce ${format} command features (${features.join(', ')}); placeholders remain literal and automatic context/execution or workflow dispatch is not reproduced`,
      );
    if (Object.keys(native).length) {
      if (claude) {
        Object.assign(metadata, native);
        changed = true;
      } else
        loss(
          'SKILL_COMMAND_FIELDS_UNSUPPORTED',
          `Skill ${resource.name}: ${p.id} omits ${format} command settings ${Object.keys(native).join(', ')}; model, tool, mode or dispatch behavior may change`,
        );
    }
  }
  const supported = (key: string) =>
    p.id === 'claude' ||
    (key === 'disable-model-invocation' && (manualControls.has(p.id) || p.id === 'codex')) ||
    (key === 'user-invocable' && userControls.has(p.id)) ||
    (key === 'argument-hint' && hintControls.has(p.id));
  const special = Object.keys(metadata).filter((key) => !standard.has(key) && !supported(key));
  if (special.length) {
    loss(
      'SKILL_EXTENSION_BLOCKED',
      `Skill ${resource.name}: ${p.id} omits native fields ${special.join(', ')}; their behavior and restrictions no longer apply`,
    );
    for (const key of special) delete metadata[key];
    changed = true;
  }
  const files = [...resource.files];
  if (p.id === 'codex' && (invocation === 'manual' || invocation === 'never')) {
    const sidecar = files.find((file) => file.path === 'agents/openai.yaml');
    if (sidecar) {
      const parsed = parseDocument(Buffer.from(sidecar.content, 'base64').toString('utf8'));
      if (parsed.errors.length || !parsed.toJSON() || typeof parsed.toJSON() !== 'object')
        throw new EtymonError('INVALID_SKILL', `Invalid Codex policy for ${resource.name}`);
      const value = parsed.toJSON();
      if (value.policy?.allow_implicit_invocation !== false)
        throw new EtymonError(
          'SKILL_POLICY_CONFLICT',
          `Skill ${resource.name} manual policy conflicts with agents/openai.yaml`,
        );
    } else
      files.push(
        ...fileArtifact(
          'agents/openai.yaml',
          yaml({ policy: { allow_implicit_invocation: false } }),
        ).files,
      );
  }
  if (changed) {
    const content = Buffer.from(
      rewriteSkillMetadata(textFile({ version: 1, files }, 'SKILL.md'), metadata),
    ).toString('base64');
    const index = files.findIndex((file) => file.path === 'SKILL.md');
    files[index] = { ...files[index], content };
  }
  return { artifact: { version: 1, files }, diagnostics };
}
