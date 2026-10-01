import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { UninstallPlan } from '../services/uninstall.js';

/** Review the uninstall and choose whether to remove the two personal files. */
export function chooseUninstall(plan: UninstallPlan): Promise<boolean | undefined> {
  const programOptions: Widgets.IScreenOptions & {
    extended: boolean;
    buffer: boolean;
    zero: boolean;
  } = {
    extended: false,
    buffer: true,
    zero: true,
  };
  const screen = blessed.screen({
    program: blessed.program(programOptions),
    smartCSR: true,
    fullUnicode: true,
    title: 'Uninstall etymon',
  });
  const description = blessed.box({
    parent: screen,
    top: 1,
    left: 2,
    right: 2,
    height: '55%',
    content: [
      'Uninstall etymon',
      '',
      plan.installation
        ? `Remove the global npm installation:\n${plan.installation.path}`
        : 'No global npm installation was found.',
      '',
      'Remove your personal config and lockfile too?',
      ...(plan.personalFiles.length
        ? plan.personalFiles
        : ['No personal config or lockfile was found.']),
      '',
      'Project files and generated tool settings stay in place.',
    ].join('\n'),
    scrollable: true,
    keys: true,
    vi: true,
    style: { fg: 'white' },
  });
  const choices = blessed.list({
    parent: screen,
    top: '58%',
    left: 2,
    right: 2,
    height: 6,
    border: 'line',
    keys: true,
    vi: true,
    mouse: true,
    items: ['Keep personal files and uninstall', 'Remove personal files and uninstall', 'Cancel'],
    style: { border: { fg: 'cyan' }, selected: { fg: 'black', bg: 'cyan' }, item: { fg: 'white' } },
  });
  blessed.box({
    parent: screen,
    bottom: 1,
    left: 2,
    right: 2,
    height: 1,
    content: '↑/↓ choose · Enter confirm · Esc cancel',
    style: { fg: 'gray' },
  });
  return new Promise((resolveChoice) => {
    let complete = false;
    const finish = (choice: boolean | undefined) => {
      if (complete) return;
      complete = true;
      screen.destroy();
      resolveChoice(choice);
    };
    choices.on('select', (_item, index) =>
      finish(index === 0 ? false : index === 1 ? true : undefined),
    );
    screen.key(['escape', 'q', 'C-c'], () => finish(undefined));
    screen.key(['tab'], () => (screen.focused === choices ? description : choices).focus());
    screen.on('resize', () => screen.render());
    choices.focus();
    screen.render();
  });
}
