import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { resolve } from 'node:path';
import { Workspace } from '../core/workspace.js';
import { errorMessage, EtymonError, Kind, kinds, Request } from '../core/model.js';
import { apply, readState, recover } from '../core/transaction.js';
import { exists } from '../core/fs.js';
import { add, buildPlan, convert, doctor, remove, update } from '../services/environment.js';
import { profile, profiles } from '../harnesses/profiles.js';
import { McpRegistry } from '../providers/mcp.js';
import { create } from '../services/create.js';
import { promptCreation } from './create.js';

type TuiOptions = { harness?: string[]; configPath?: string; rulesPath?: string; debug?: boolean };
type Choice<T> = { label: string; value: T };
const clean = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** neo-blessed owns rendering, focus, terminal modes, input, widgets, and resize. */
export class EtymonTui {
  screen: Widgets.Screen;
  menu: Widgets.ListElement;
  body: Widgets.BoxElement;
  footer: Widgets.BoxElement;
  header: Widgets.BoxElement;
  private busy = false;
  private modal = false;
  private quitting = false;
  private selected: string[] = [];
  private done!: () => void;
  private actions = [
    'Environment',
    'Add skill',
    'Add MCP server',
    'Add agent',
    'Add rule',
    'Sync / preview',
    'Import native setup',
    'Update dependencies',
    'Remove resource',
    'Doctor',
    'Harnesses',
  ];
  constructor(
    private workspace: Workspace,
    private options: TuiOptions = {},
  ) {
    this.selected = options.harness?.flatMap((s) => s.split(',')).map((s) => profile(s).id) ?? [];
    // Modern extended terminfo entries (notably Setulc) exceed neo-blessed's parser.
    // The standard terminal capabilities provide every widget feature used here.
    const programOptions: Widgets.IScreenOptions & {
      extended: boolean;
      buffer: boolean;
      zero: boolean;
    } = {
      extended: false,
      buffer: true,
      zero: true,
    };
    this.screen = blessed.screen({
      program: blessed.program(programOptions),
      smartCSR: true,
      fullUnicode: true,
      title: 'etymon',
      dockBorders: true,
      autoPadding: true,
    });
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: 'etymon',
      style: { fg: 'cyan' },
      padding: { left: 1, top: 0 },
    });
    this.menu = blessed.list({
      parent: this.screen,
      top: 3,
      bottom: 2,
      left: 0,
      width: 24,
      label: ' Actions ',
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      items: this.actions,
      style: {
        border: { fg: 'gray' },
        selected: { fg: 'black', bg: 'cyan' },
        item: { fg: 'white' },
      },
    });
    this.body = blessed.box({
      parent: this.screen,
      top: 3,
      bottom: 2,
      left: 24,
      right: 0,
      label: ' Environment ',
      border: 'line',
      padding: { left: 1, right: 1 },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: '│', style: { fg: 'cyan' } },
      style: { border: { fg: 'gray' }, fg: 'white' },
    });
    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      height: 2,
      left: 1,
      width: '100%-2',
      content: '↑/↓ navigate · Enter select · Tab focus · h harnesses · r refresh · q quit',
      style: { fg: 'gray' },
    });
    this.menu.on('select', (_item, index) => {
      if (!this.busy && !this.modal) void this.dispatch(index);
    });
    this.screen.key(['tab'], () => {
      if (!this.modal) (this.screen.focused === this.menu ? this.body : this.menu).focus();
    });
    this.screen.key(['q', 'C-c'], () => {
      if (!this.modal) {
        if (this.busy) {
          this.quitting = true;
          this.status('Finishing the current operation before exit…');
        } else this.close();
      }
    });
    this.screen.key(['h'], () => {
      if (!this.busy && !this.modal)
        void this.perform('Harness selection', async () => {
          await this.chooseHarnesses();
          await this.dashboard();
        });
    });
    this.screen.key(['r'], () => {
      if (!this.busy && !this.modal) void this.perform('Refresh', () => this.dashboard());
    });
    this.screen.on('resize', () => this.screen.render());
    this.menu.focus();
  }
  async start(): Promise<void> {
    if (!this.selected.length) this.selected = (await readState(this.workspace)).targets;
    await this.dashboard();
    return new Promise((resolveDone) => {
      this.done = resolveDone;
    });
  }
  close(): void {
    this.screen.destroy();
    this.done?.();
  }
  private status(text: string): void {
    this.footer.setContent(clean(text));
    this.screen.render();
  }
  private show(title: string, text: string): void {
    this.body.setLabel(` ${title} `);
    this.body.setContent(clean(text));
    this.body.setScroll(0);
    this.screen.render();
  }
  private async perform(title: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status(`${title}…`);
    try {
      await fn();
      this.status('↑/↓ navigate · Enter select · Tab focus · h harnesses · r refresh · q quit');
    } catch (error) {
      this.show(
        'Needs attention',
        `${error instanceof EtymonError ? '[' + error.code + '] ' : ''}${errorMessage(error)}${error instanceof EtymonError && error.details ? '\n\n' + pretty(error.details) : ''}${this.options.debug && error instanceof Error ? '\n\n' + error.stack : ''}`,
      );
      this.status(
        'Operation stopped. Your environment is still available. Esc closes dialogs; q quits.',
      );
    } finally {
      this.busy = false;
      if (this.quitting) this.close();
    }
  }
  private async mutation<T>(fn: () => Promise<T>): Promise<T> {
    return this.workspace.exclusive(async () => {
      await recover(this.workspace);
      return fn();
    });
  }
  private async dashboard(): Promise<void> {
    const lock = await this.workspace.lock(),
      manifest = await this.workspace.manifest();
    this.header.setContent(
      `etymon  ·  ${this.workspace.global ? 'personal' : 'project'}\n${this.workspace.root}`,
    );
    const local = kinds.flatMap((kind) =>
      Object.entries(manifest[kind]).map(
        ([name, entry]) =>
          `${kind.padEnd(6)} ${name}  ·  ${'path' in entry ? entry.path : 'custom connection'}`,
      ),
    );
    const external = lock.dependencies.flatMap((dep) =>
      dep.artifacts.map(
        (a) =>
          `${dep.kind.padEnd(6)} ${a.name}  ·  ${dep.resolved.commit?.slice(0, 12) ?? dep.resolved.version ?? a.digest.slice(7, 19)}`,
      ),
    );
    this.show(
      'Environment',
      `Targets: ${this.selected.join(', ') || 'press h to choose'}\n\n${external.length || local.length ? 'Locked external resources\n' + (external.join('\n') || 'None') + '\n\nAuthored resources\n' + (local.join('\n') || 'None') : 'Build your portable agent environment.\n\nAdd skills, MCP servers, agents, or rules from the menu.\nPreview sync before writing native harness configuration.\nImport an existing setup to create editable local source.'}\n\nLock: .agents/etymon.lock\nAuthored: .agents/etymon.toml\n\nNative files are written only through Sync.\nImports leave the original setup in place.`,
    );
  }
  private ask(message: string, initial = ''): Promise<string | undefined> {
    this.modal = true;
    const dialog = blessed.prompt({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: 9,
      label: ' Input ',
      border: 'line',
      keys: true,
      vi: false,
      mouse: true,
      style: { border: { fg: 'cyan' }, fg: 'white', bg: 'black' },
    });
    return new Promise((resolveInput) => {
      dialog.input(clean(message), initial, (_error, value) => {
        dialog.destroy();
        this.modal = false;
        this.menu.focus();
        this.screen.render();
        resolveInput(value?.trim());
      });
    });
  }
  private choose<T>(message: string, choices: Choice<T>[]): Promise<T | undefined> {
    this.modal = true;
    const dialog = blessed.list({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: Math.min(choices.length + 4, Math.max(8, Number(this.screen.height) - 4)),
      label: ` ${clean(message)} `,
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      items: choices.map((c) => clean(c.label)),
      style: {
        border: { fg: 'cyan' },
        selected: { fg: 'black', bg: 'cyan' },
        fg: 'white',
        bg: 'black',
      },
    });
    return new Promise((resolveChoice) => {
      let complete = false;
      const finish = (value: T | undefined) => {
        if (complete) return;
        complete = true;
        dialog.destroy();
        this.modal = false;
        this.menu.focus();
        this.screen.render();
        resolveChoice(value);
      };
      dialog.on('select', (_item, index) => finish(choices[index]?.value));
      dialog.key(['escape', 'C-c'], () => finish(undefined));
      dialog.focus();
      this.screen.render();
    });
  }
  private async chooseHarnesses(): Promise<void> {
    this.modal = true;
    const chosen = new Set(this.selected);
    const labels = () =>
      profiles.map((p) => `${chosen.has(p.id) ? '[x]' : '[ ]'} ${p.label} (${p.id})`);
    const dialog = blessed.list({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '85%',
      label: ' Targets · Space toggles · Enter saves · Esc cancels ',
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      items: labels(),
      style: {
        border: { fg: 'cyan' },
        selected: { fg: 'black', bg: 'cyan' },
        fg: 'white',
        bg: 'black',
      },
    });
    await new Promise<void>((resolveDone) => {
      const finish = (save: boolean) => {
        if (save) this.selected = [...chosen];
        dialog.destroy();
        this.modal = false;
        this.menu.focus();
        this.screen.render();
        resolveDone();
      };
      dialog.key(['space'], () => {
        const index = (dialog as Widgets.ListElement & { selected: number }).selected;
        const id = profiles[index]?.id;
        if (id) {
          chosen.has(id) ? chosen.delete(id) : chosen.add(id);
          dialog.setItems(labels());
          dialog.select(index);
          this.screen.render();
        }
      });
      dialog.key(['enter'], () => finish(true));
      dialog.key(['escape', 'C-c'], () => finish(false));
      dialog.focus();
      this.screen.render();
    });
  }
  private async addResource(kind: Kind): Promise<void> {
    let source: string | undefined;
    if (kind === 'mcp') {
      const query = await this.ask('Search official MCP registry (or enter an exact server ID)');
      if (query === undefined) return;
      if (!query) {
        await this.createResource(kind);
        return;
      }
      if (query.includes('/')) source = query;
      else {
        const result = await new McpRegistry().search(query);
        if (!result.servers.length) {
          this.show('MCP registry', 'No results. Try a different query.');
          return;
        }
        source = await this.choose(
          'Select server',
          result.servers.map((s) => ({
            label: `${s.name} @ ${s.version} · ${s.description ?? ''}`,
            value: s.name,
          })),
        );
      }
    } else
      source = await this.ask(
        `Add ${kind}: owner/repo[/path], Git URL, direct file URL, or local path`,
      );
    if (source === undefined) return;
    if (!source) {
      await this.createResource(kind);
      return;
    }
    const request: Request = { source, names: [] };
    if (kind !== 'mcp') {
      const names = await this.ask(`${kind} names, comma-separated (leave empty for all)`);
      if (names === undefined) return;
      request.names = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
    } else if (!(await exists(resolve(this.workspace.cwd, source)))) {
      const server = await new McpRegistry().get(source);
      const implementations: Choice<{ package?: string; remote?: number }>[] = [
        ...(server.packages ?? []).map((p) => ({
          label: `${p.registryType} ${p.identifier}@${p.version}`,
          value: { package: p.identifier },
        })),
        ...(server.remotes ?? []).map((r, index) => ({
          label: `${r.type} ${r.url}`,
          value: { remote: index },
        })),
      ];
      if (implementations.length > 1) {
        const selection = await this.choose('Choose implementation', implementations);
        if (!selection) return;
        Object.assign(request, selection);
      }
      const inputs = await this.ask(
        'Optional inputs: NAME=value,NAME=env:VARIABLE. Secret inputs require env references.',
      );
      if (inputs === undefined) return;
      if (inputs) {
        request.inputs = {};
        for (const pair of inputs.split(',')) {
          const split = pair.indexOf('=');
          if (split < 1)
            throw new EtymonError('INVALID_INPUT', 'Use NAME=value or NAME=env:VARIABLE');
          const value = pair.slice(split + 1);
          request.inputs[pair.slice(0, split).trim()] = value.startsWith('env:')
            ? { env: value.slice(4) }
            : value;
        }
      }
    }
    if (kind === 'rule' && !this.workspace.global) {
      const destination = await this.ask(
        'Optional project directory scope, such as src/api (blank: preserve detected scope)',
      );
      if (destination === undefined) return;
      if (destination.trim()) request.destDir = destination.trim();
    }
    this.status(`Resolving ${kind} source…`);
    const added = await this.mutation(() => add(this.workspace, kind, request));
    this.show(
      'Added',
      `${added.names.join('\n')}\n\nRegistered in your environment. Use Sync / preview to activate.\n\n${added.ids.join('\n')}`,
    );
  }
  private async syncFlow(): Promise<void> {
    if (!this.selected.length) await this.chooseHarnesses();
    if (!this.selected.length) return;
    if ((this.options.configPath || this.options.rulesPath) && this.selected.length !== 1)
      throw new EtymonError('CONFIG_PATH_SCOPE', 'An explicit config path requires one target');
    const options: {
      configPath?: string;
      rulesPath?: string;
      adopt?: boolean;
      force?: boolean;
      allowLossy?: boolean;
    } = { configPath: this.options.configPath, rulesPath: this.options.rulesPath };
    let plan;
    try {
      plan = await buildPlan(this.workspace, this.selected, options);
    } catch (error) {
      if (
        !(error instanceof EtymonError) ||
        !['UNMANAGED_CONFLICT', 'MANAGED_DRIFT'].includes(error.code)
      )
        throw error;
      this.show('Ownership conflict', error.message);
      const accepted = await this.choose('Review a plan resolving this conflict?', [
        {
          label:
            error.code === 'UNMANAGED_CONFLICT'
              ? 'Preview taking ownership of existing output'
              : 'Preview replacing edits to managed output',
          value: true,
        },
        { label: 'Cancel and preserve current files', value: false },
      ]);
      if (!accepted) return;
      if (error.code === 'UNMANAGED_CONFLICT') options.adopt = true;
      else options.force = true;
      plan = await buildPlan(this.workspace, this.selected, options);
    }
    if (
      plan.diagnostics.some((d) =>
        ['NATIVE_FIELD_UNMAPPED', 'MODEL_MAPPING_REQUIRED'].includes(d.code),
      )
    ) {
      this.show(
        'Optional adaptation',
        plan.diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n'),
      );
      const accepted = await this.choose('Review optional metadata / model adaptation?', [
        { label: 'Preview optional adaptation', value: true },
        { label: 'Keep source semantics; cancel', value: false },
      ]);
      if (!accepted) return;
      options.allowLossy = true;
      plan = await buildPlan(this.workspace, this.selected, options);
    }
    this.show(
      'Sync preview',
      [
        ...plan.summary.map((c) => `${c.action}  ${c.path}`),
        ...plan.diagnostics.map((d) => `${d.severity} [${d.code}] ${d.message}`),
      ].join('\n') || 'Already in sync.',
    );
    if (plan.diagnostics.some((d) => d.severity === 'error') || !plan.summary.length) return;
    const choice = await this.choose('Apply this reviewed sync plan?', [
      { label: 'Apply native changes', value: true },
      { label: 'Keep preview only', value: false },
    ]);
    if (choice) {
      await this.mutation(() => apply(this.workspace, plan));
      this.show(
        'Synced',
        `${plan.summary.length} file changes applied.\n\n${plan.summary.map((c) => `${c.action} ${c.path}`).join('\n')}\n\n${plan.diagnostics.map((d) => `${d.severity}: ${d.message}`).join('\n')}`,
      );
    }
  }
  private async createResource(kind: Kind): Promise<void> {
    this.modal = true;
    try {
      const draft = await promptCreation(kind, {}, this.screen);
      const result = await this.mutation(() => create(this.workspace, draft));
      this.show('Created', `${result.names.join(', ')}\n\n${result.path}\n\nRun Sync to activate.`);
    } finally {
      this.modal = false;
      this.menu.focus();
      this.screen.render();
    }
  }
  private async importFlow(): Promise<void> {
    const target = await this.choose(
      'Import source harness',
      profiles.map((p) => ({ label: p.label, value: p.id })),
    );
    if (!target) return;
    const options = { configPath: this.options.configPath, rulesPath: this.options.rulesPath };
    const preview = await convert(this.workspace, target, { ...options, dryRun: true });
    this.show(
      'Import preview',
      `${preview.resources.map((r) => `${r.kind} ${r.name}\n  ${r.origin}\n  → ${r.destination}`).join('\n\n') || 'No supported resources found.'}\n\n${preview.diagnostics.map((d) => `${d.severity} [${d.code}] ${d.message}`).join('\n')}`,
    );
    if (preview.diagnostics.some((d) => d.severity === 'error') || !preview.resources.length)
      return;
    const applyImport = await this.choose('Create editable source? Originals stay in place.', [
      { label: 'Import these resources', value: true },
      { label: 'Keep preview only', value: false },
    ]);
    if (applyImport) {
      await this.mutation(() => convert(this.workspace, target, options));
      this.show(
        'Imported',
        `${preview.resources.length} resources imported into .agents/etymon/.\n\nChoose targets and Sync to activate.`,
      );
    }
  }
  private async removeFlow(): Promise<void> {
    const lock = await this.workspace.lock(),
      manifest = await this.workspace.manifest();
    const choices: Choice<{ kind: Kind; id: string }>[] = [
      ...lock.dependencies.map((dep) => ({
        label: `${dep.kind}: ${dep.artifacts.map((a) => a.name).join(', ')} (external)`,
        value: { kind: dep.kind, id: dep.id },
      })),
      ...kinds.flatMap((kind) =>
        Object.keys(manifest[kind]).map((name) => ({
          label: `${kind}: ${name} (authored)`,
          value: { kind, id: `${kind}:local/${name}` },
        })),
      ),
    ];
    if (!choices.length) {
      this.show('Remove', 'Your environment is empty.');
      return;
    }
    const selection = await this.choose('Remove resource', choices);
    if (!selection) return;
    const preview = await remove(this.workspace, selection.kind, selection.id, { dryRun: true });
    this.show(
      'Removal preview',
      `Remove ${selection.id}\n\n${preview.plan.summary.map((c) => `${c.action} ${c.path}`).join('\n')}\n\nAuthored source files stay in place.\n${preview.plan.diagnostics.map((d) => `${d.severity}: ${d.message}`).join('\n')}`,
    );
    if (preview.plan.diagnostics.some((d) => d.severity === 'error')) return;
    const accepted = await this.choose('Remove this registration and owned output?', [
      { label: 'Remove', value: true },
      { label: 'Cancel', value: false },
    ]);
    if (accepted) {
      await this.mutation(() => remove(this.workspace, selection.kind, selection.id));
      await this.dashboard();
    }
  }
  private async dispatch(index: number): Promise<void> {
    await this.perform(this.actions[index], async () => {
      switch (index) {
        case 0:
          await this.dashboard();
          break;
        case 1:
          await this.addResource('skill');
          break;
        case 2:
          await this.addResource('mcp');
          break;
        case 3:
          await this.addResource('agent');
          break;
        case 4:
          await this.addResource('rule');
          break;
        case 5:
          await this.syncFlow();
          break;
        case 6:
          await this.importFlow();
          break;
        case 7: {
          const result = await this.mutation(() => update(this.workspace));
          this.show(
            'Updated',
            result.updated.length
              ? `${result.updated.join('\n')}\n\nSync to activate updated resolutions.`
              : 'External dependencies are already current.',
          );
          break;
        }
        case 8:
          await this.removeFlow();
          break;
        case 9: {
          const result = await doctor(this.workspace, this.selected, {
            configPath: this.options.configPath,
            rulesPath: this.options.rulesPath,
          });
          this.show(
            'Doctor',
            `${result.ok ? 'Environment checks passed.' : 'Needs attention.'}\n\n${result.diagnostics.map((d) => `${d.severity} [${d.code}] ${d.message}`).join('\n')}`,
          );
          break;
        }
        case 10:
          this.show(
            'Harness capabilities',
            profiles
              .map(
                (p) =>
                  `${p.id} · ${p.label}\nSkills: ${p.skill ? 'native' : 'unverified'}  Agents: ${p.agent ? 'native' : 'blocked'}  MCP: ${p.mcp ? 'native' : 'explicit config / service'}  Rules: ${p.rule ? 'native' : 'blocked'}\n${[...(p.notes ?? []), ...(p.rule?.notes ?? [])].join('\n')}`,
              )
              .join('\n\n'),
          );
          break;
      }
    });
  }
}
export async function launchTui(workspace: Workspace, options: TuiOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new EtymonError(
      'TTY_REQUIRED',
      'The TUI needs an interactive terminal. Use etymon --help or subcommands with --json for automation.',
    );
  const debug = workspace.debug;
  workspace.debug = false;
  const tui = new EtymonTui(workspace, options);
  try {
    await tui.start();
  } finally {
    tui.close();
    workspace.debug = debug;
  }
}
