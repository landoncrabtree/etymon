import type { Diagnostic } from '../core/model.js';

// Only representability failures qualify. Validation, ownership, loader settings,
// and filesystem failures remain errors even when lossy conversion is requested.
const conversionLimits = new Set([
  'CAPABILITY_UNSUPPORTED',
  'NATIVE_FIELD_UNMAPPED',
  'MODEL_MAPPING_REQUIRED',
  'REQUIRED_SEMANTICS_BLOCKED',
  'TOOL_MAPPING_BLOCKED',
  'TOOL_RESTRICTION_BLOCKED',
  'SKILL_EXTENSION_BLOCKED',
  'SKILL_INVOCATION_UNSUPPORTED',
  'SKILL_COMMAND_FIELDS_UNSUPPORTED',
  'COMMAND_TEMPLATE_UNSUPPORTED',
  'MCP_NATIVE_FIELDS_BLOCKED',
  'TRANSPORT_UNSUPPORTED',
  'SECRET_REFERENCE_UNSUPPORTED',
  'RULE_NATIVE_FIELDS_BLOCKED',
  'RULE_ACTIVATION_UNSUPPORTED',
  'RULE_SCOPE_UNSUPPORTED',
  'RULE_SIZE_LIMIT',
]);

export function isConversionLimit(code: string): boolean {
  return conversionLimits.has(code);
}

export function omittedResource(diagnostic: Diagnostic): Diagnostic {
  return {
    ...diagnostic,
    code: 'RESOURCE_OMITTED',
    severity: 'warning',
    message: `Omitted ${diagnostic.resource ?? 'resource'} from ${diagnostic.harness} output (${diagnostic.code}): ${diagnostic.message}`,
  };
}
