import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { Kind, EtymonError } from '../core/model.js';
import { Creation, CreationDraft, creationSchema, creationValues } from '../services/create.js';
import { splitGlobs } from '../providers/rules.js';

function values(text: string) {
  if (!text.trim()) return {};
  return text.trim().startsWith('{')
    ? JSON.parse(text)
    : creationValues(
        text
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
}

/** One visible form, using the same schema as headless creation. */
export function promptCreation(
  kind: Kind,
  initial: CreationDraft = {},
  host?: Widgets.Screen,
): Promise<Creation> {
  const programOptions: Widgets.IScreenOptions & {
    extended: boolean;
    buffer: boolean;
    zero: boolean;
  } = { extended: false, buffer: true, zero: true };
  const screen =
    host ??
    blessed.screen({
      program: blessed.program(programOptions),
      smartCSR: true,
      fullUnicode: true,
      title: `Create ${kind}`,
    });
  // neo-blessed uses an array here; the upstream blessed typings say boolean.
  const keyScreen = screen as unknown as { ignoreLocked: string[] };
  const previousLocked = keyScreen.ignoreLocked;
  keyScreen.ignoreLocked = [...previousLocked, 'C-s', 'C-c'];
  const form = blessed.form({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    // Form's default arrow bindings leave textareas and transport lists.
    // Keep each widget's native editing keys and use Tab for field navigation.
    keys: false,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '│' },
    style: { bg: 'black', fg: 'white' },
  });
  blessed.box({
    parent: form,
    top: 0,
    left: 2,
    height: 2,
    content: `Create ${kind} · Tab moves between fields · Ctrl+S saves · Ctrl+C cancels`,
    style: { fg: 'cyan' },
  });
  let row = 3;
  const fields = new Map<string, Widgets.TextareaElement>();
  const groups = new Map<string, Widgets.BoxElement[]>();
  const input = (key: string, label: string, help: string, value = '', multiline = false) => {
    const title = blessed.box({
      parent: form,
      top: row,
      left: 2,
      right: 2,
      height: 1,
      content: label,
      style: { fg: 'cyan' },
    });
    const hint = blessed.box({
      parent: form,
      top: row + 1,
      left: 2,
      right: 2,
      height: 1,
      content: help,
      style: { fg: 'gray' },
    });
    const options = {
      parent: form,
      top: row + 2,
      left: 2,
      right: 2,
      height: multiline ? 9 : 3,
      value,
      border: 'line' as const,
      keys: true,
      mouse: true,
      inputOnFocus: false,
      style: { bg: 'black', fg: 'white', focus: { border: { fg: 'cyan' } } },
    };
    const field = multiline ? blessed.textarea(options) : blessed.textbox(options);
    // Start the library's input mode without its automatic focus rewind on blur.
    field.on('focus', () => field.readInput());
    field.key(['tab'], () => {
      // Textarea receives the tab character before its named-key callback.
      if (field.getValue().endsWith('\t')) field.setValue(field.getValue().slice(0, -1));
      field.cancel();
      form.focusNext();
    });
    field.key(['S-tab'], () => {
      field.cancel();
      form.focusPrevious();
    });
    fields.set(key, field);
    groups.set(key, [title, hint, field]);
    row += multiline ? 13 : 7;
    return field;
  };
  input('name', 'Name', 'A unique lowercase name, such as api-reviewer', initial.name);
  let transport: Widgets.ListElement | undefined;
  if (kind === 'mcp') {
    blessed.box({
      parent: form,
      top: row,
      left: 2,
      height: 1,
      content: 'Transport',
      style: { fg: 'cyan' },
    });
    transport = blessed.list({
      parent: form,
      top: row + 1,
      left: 2,
      right: 2,
      height: 5,
      border: 'line',
      keys: true,
      mouse: true,
      items: ['STDIO', 'HTTP', 'SSE'],
      style: { selected: { bg: 'blue', fg: 'white' }, fg: 'white' },
    });
    transport.select(
      initial.connection?.transport === 'streamable-http'
        ? 1
        : initial.connection?.transport === 'sse'
          ? 2
          : 0,
    );
    transport.key(['tab'], () => form.focusNext());
    transport.key(['S-tab'], () => form.focusPrevious());
    row += 7;
    const connection = initial.connection;
    input(
      'command',
      'Command (STDIO)',
      'Executable only; put arguments in the next field',
      connection?.transport === 'stdio' ? connection.command : '',
    );
    input(
      'args',
      'Arguments (STDIO)',
      'JSON array, for example ["-y", "@example/mcp"]',
      connection?.transport === 'stdio' ? JSON.stringify(connection.args) : '[]',
    );
    input(
      'cwd',
      'Working directory (STDIO)',
      'Optional; blank uses the tool default',
      connection?.transport === 'stdio' ? connection.cwd : '',
    );
    input(
      'env',
      'Environment (STDIO)',
      'NAME=env:VARIABLE pairs or a JSON object',
      connection?.transport === 'stdio' ? JSON.stringify(connection.env) : '',
    );
    input(
      'url',
      'URL (HTTP / SSE)',
      'Server endpoint',
      connection && connection.transport !== 'stdio' ? connection.url : '',
    );
    input(
      'headers',
      'Headers (HTTP / SSE)',
      'Authorization=env:MCP_AUTH or a JSON object',
      connection && connection.transport !== 'stdio' ? JSON.stringify(connection.headers) : '',
    );
  } else {
    input(
      'description',
      'Description',
      kind === 'rule'
        ? 'Optional, unless activation uses agent selection'
        : 'When should this resource be used?',
      initial.description,
    );
    input(
      'body',
      'Instructions',
      'Multiline text; Tab leaves the editor, Ctrl+S saves the form',
      initial.body,
      true,
    );
    if (kind === 'agent') {
      input('model', 'Model', 'Optional model preference', initial.model);
      input(
        'tools',
        'Tools',
        'Optional comma-separated allowlist; blank adds no restriction',
        initial.tools?.join(', '),
      );
    } else if (kind === 'skill') {
      input('license', 'License', 'Optional license name', initial.license);
      input('compatibility', 'Compatibility', 'Optional requirements', initial.compatibility);
    } else {
      input(
        'destDir',
        'Directory scope',
        'Project-relative directory, for example packages/api',
        initial.destDir ?? '.',
      );
      input(
        'activation',
        'Activation',
        'always, glob, model, manual, or never',
        initial.activation ?? 'always',
      );
      input(
        'patterns',
        'File patterns',
        'Comma-separated globs, when activation is glob',
        initial.patterns?.join(', '),
      );
    }
  }
  const save = blessed.button({
    parent: form,
    top: row,
    left: 2,
    width: 18,
    height: 3,
    content: ' Save resource ',
    keys: true,
    mouse: true,
    border: 'line',
    style: { fg: 'white', focus: { bg: 'blue' } },
  });
  const cancel = blessed.button({
    parent: form,
    top: row,
    left: 22,
    width: 12,
    height: 3,
    content: ' Cancel ',
    keys: true,
    mouse: true,
    border: 'line',
    style: { fg: 'white', focus: { bg: 'blue' } },
  });
  const error = blessed.box({
    parent: form,
    top: row + 4,
    left: 2,
    right: 2,
    height: 5,
    style: { fg: 'red' },
  });
  if (transport) {
    const layout = () => {
      const stdio = (transport as Widgets.ListElement & { selected: number }).selected === 0;
      let position = Number(transport!.top) + 6;
      for (const key of ['command', 'args', 'cwd', 'env', 'url', 'headers']) {
        const visible = stdio === !['url', 'headers'].includes(key);
        groups.get(key)!.forEach((element, index) => {
          if (visible) {
            element.top = position + index;
            element.show();
          } else element.hide();
        });
        if (visible) position += 7;
      }
      save.top = cancel.top = position;
      error.top = position + 4;
      screen.render();
    };
    transport.on('select item', layout);
    layout();
  }
  const get = (key: string) => fields.get(key)?.getValue() ?? '';
  return new Promise((resolveDraft, reject) => {
    let complete = false;
    const finish = (draft?: Creation) => {
      if (complete) return;
      complete = true;
      screen.unkey('C-s', submit);
      screen.unkey('C-c', abort);
      fields.forEach((field) => field.cancel());
      keyScreen.ignoreLocked = previousLocked;
      form.destroy();
      if (!host) screen.destroy();
      else screen.render();
      if (draft) resolveDraft(draft);
      else reject(new EtymonError('CANCELLED', 'Creation cancelled'));
    };
    const abort = () => finish();
    const submit = () => {
      try {
        const draft: Record<string, unknown> = { kind, name: get('name').trim() };
        if (kind === 'mcp') {
          const index = (transport as Widgets.ListElement & { selected: number }).selected;
          draft.connection =
            index === 0
              ? {
                  transport: 'stdio',
                  command: get('command'),
                  args: JSON.parse(get('args') || '[]'),
                  env: values(get('env')),
                  ...(get('cwd') ? { cwd: get('cwd') } : {}),
                }
              : {
                  transport: index === 1 ? 'streamable-http' : 'sse',
                  url: get('url'),
                  headers: values(get('headers')),
                };
        } else {
          draft.body = get('body');
          if (kind !== 'rule' || get('description')) draft.description = get('description');
          if (kind === 'skill')
            for (const key of ['license', 'compatibility']) {
              if (get(key)) draft[key] = get(key);
            }
          if (kind === 'agent') {
            if (get('model')) draft.model = get('model');
            if (get('tools'))
              draft.tools = get('tools')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
          }
          if (kind === 'rule') {
            draft.destDir = get('destDir');
            draft.activation = get('activation');
            draft.patterns = splitGlobs(get('patterns'));
          }
        }
        const parsed = creationSchema.safeParse(draft);
        if (!parsed.success)
          throw new Error(
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('\n'),
          );
        finish(parsed.data);
      } catch (problem) {
        error.setContent(problem instanceof Error ? problem.message : String(problem));
        form.setScrollPerc(100);
        screen.render();
      }
    };
    save.on('press', submit);
    cancel.on('press', abort);
    screen.key('C-s', submit);
    screen.key('C-c', abort);
    form.focusNext();
    screen.render();
  });
}
