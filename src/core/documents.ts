import { applyEdits, modify, parseTree, ParseError } from 'jsonc-parser';
import { parse as toml, stringify as tomlStringify } from 'smol-toml';
import { EtymonError } from './model.js';

export type DocumentFormat = 'json' | 'toml';
export function readDocument(text: string, format: DocumentFormat): Record<string, unknown> {
  if (format === 'toml') return toml(text);
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !tree || tree.type !== 'object')
    throw new EtymonError('INVALID_NATIVE_CONFIG', 'Expected a valid JSON/JSONC object');
  function check(node: NonNullable<typeof tree>): unknown {
    if (node.type === 'object') {
      const result: Record<string, unknown> = Object.create(null),
        seen = new Set<string>();
      for (const property of node.children ?? []) {
        const key = String(property.children![0].value);
        if (seen.has(key))
          throw new EtymonError('DUPLICATE_NATIVE_KEY', `Duplicate JSON key ${key}`);
        seen.add(key);
        result[key] = check(property.children![1]);
      }
      return result;
    }
    if (node.type === 'array') return node.children?.map(check) ?? [];
    return node.value;
  }
  return check(tree) as Record<string, unknown>;
}
export function entry(document: Record<string, unknown>, key: string[]): unknown {
  let current: unknown = document;
  for (const part of key) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function tablePath(header: string): string[] | undefined {
  try {
    let current: unknown = toml(header + '\n__etymon_probe = true\n');
    const result: string[] = [];
    while (current && typeof current === 'object') {
      const keys = Object.keys(current);
      if (keys.includes('__etymon_probe')) return result;
      if (keys.length !== 1) return undefined;
      result.push(keys[0]);
      current = (current as Record<string, unknown>)[keys[0]];
    }
  } catch {
    return undefined;
  }
  return undefined;
}
function outsideMultiline(text: string, index: number): boolean {
  let multiline: string | undefined,
    quote: string | undefined,
    comment = false;
  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (comment) {
      if (char === '\n') comment = false;
      continue;
    }
    if (multiline) {
      if (text.slice(i, i + 3) === multiline && (multiline === "'''" || text[i - 1] !== '\\')) {
        multiline = undefined;
        i += 2;
      }
      continue;
    }
    if (quote) {
      if (char === quote && (quote === "'" || text[i - 1] !== '\\')) quote = undefined;
      continue;
    }
    if (char === '#') {
      comment = true;
      continue;
    }
    if (text.slice(i, i + 3) === '"""' || text.slice(i, i + 3) === "'''") {
      multiline = text.slice(i, i + 3);
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
  }
  return !multiline && !quote;
}
export function editDocument(
  text: string,
  key: string[],
  value: unknown,
  format: DocumentFormat,
): string {
  readDocument(text, format);
  if (format === 'json')
    return applyEdits(
      text,
      modify(text, key, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
      }),
    );
  if (key.length !== 2)
    throw new EtymonError(
      'TOML_EDIT_UNSUPPORTED',
      'TOML managed units must be a named table entry',
    );
  const sectionRegex = /^[ \t]*(\[(?!\[)[^\r\n]+\])[ \t]*(?:#[^\r\n]*)?\r?$/gm;
  const sections = [...text.matchAll(sectionRegex)]
    .filter((match) => outsideMultiline(text, match.index!))
    .map((match) => ({ start: match.index!, path: tablePath(match[1]) }));
  const ranges = sections
    .map((section, index) => ({ ...section, end: sections[index + 1]?.start ?? text.length }))
    .filter(
      (s) =>
        s.path &&
        s.path.length >= key.length &&
        key.every((part, index) => s.path![index] === part),
    );
  const current = entry(readDocument(text, format), key);
  if (current !== undefined && !ranges.length)
    throw new EtymonError(
      'TOML_EDIT_UNSUPPORTED',
      `Managed TOML entry ${key.join('.')} is inline; move it to a table before syncing`,
    );
  // Full TOML parsing prevents matching apparent table headers inside multiline strings:
  // a probe header with the expected path must also correspond to the parsed entry.
  let output = text;
  for (const range of ranges.reverse())
    output = output.slice(0, range.start) + output.slice(range.end);
  if (value !== undefined) {
    const fragment = tomlStringify({ [key[0]]: { [key[1]]: value } });
    output = output.trimEnd() + '\n\n' + fragment;
  }
  readDocument(output, format);
  return output;
}
