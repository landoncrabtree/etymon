import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Run `node scripts/readme-comparison.mjs` to regenerate both README themes.
const output = new URL('../docs/assets/', import.meta.url);
const evidence = JSON.parse(readFileSync(new URL('../docs/demos/lobehub.json', import.meta.url)));
const palettes = {
  light: {
    page: '#ffffff',
    panel: '#ffffff',
    subtle: '#f6f8fa',
    border: '#d1d9e0',
    text: '#1f2328',
    muted: '#59636e',
    folder: '#54aeff',
    link: '#0969da',
    success: '#1a7f37',
    selected: '#eefbf1',
  },
  dark: {
    page: '#0d1117',
    panel: '#0d1117',
    subtle: '#151b23',
    border: '#3d444d',
    text: '#f0f6fc',
    muted: '#b1bac4',
    folder: '#4493f8',
    link: '#79c0ff',
    success: '#56d364',
    selected: '#12261b',
  },
};
const beforeDetails = {
  '.agents': 'Skills + helpers',
  '.claude': 'Skills + prompts',
  '.codex': 'Skill symlink',
  '.cursor': 'Skills + docs',
  '.gemini': 'Skill symlink',
  '.github': 'CI and community',
  'AGENTS.md': 'Project instructions',
  'GEMINI.md': 'Instruction bridge',
};
const afterDetails = {
  '.agents': `${evidence.registered.skills} skills, ${evidence.registered.rules} rules`,
  '.claude': 'Workflow prompts',
  '.cursor': 'Reference docs',
  '.github': 'CI and community',
};
const sources = [
  ['file', 'etymon.toml', 'Manifest'],
  ['file', 'etymon.lock', 'Locked sources'],
  ['folder', 'etymon', 'Skills + rules'],
];

function icon(name, x, y, size = 26) {
  return `<use href="#${name}" x="${x}" y="${y}" width="${size}" height="${size}" />`;
}

function row(x, y, name, detail, type = 'folder', shared = false, retained = false) {
  return `<g>
    ${shared ? `<rect x="${x + 1}" y="${y}" width="538" height="48" fill="var(--selected)" />` : ''}
    ${icon(type, x + 22, y + 11)}
    <text class="filename${retained ? ' retained' : ''}" x="${x + 64}" y="${y + 32}"${shared ? ' font-weight="600"' : ''}>${name}</text>
    <text class="detail${shared ? ' success' : ''}" x="${x + 306}" y="${y + 31}">${detail}</text>
    <path class="line" d="M${x} ${y + 48}h540" />
  </g>`;
}

function chrome(x, detail) {
  return `<rect class="panel" x="${x}" y="104" width="540" height="610" rx="8" />
  ${icon('repo', x + 22, 122, 23)}
  <text class="repository" x="${x + 57}" y="142">lobehub / <tspan font-weight="600">lobehub</tspan></text>
  <path class="line" d="M${x} 160h540" />
  <rect class="subtle" x="${x + 20}" y="174" width="160" height="38" rx="6" />
  ${icon('branch', x + 33, 184, 19)}
  <text class="branch" x="${x + 60}" y="200">${evidence.commit.slice(0, 7)}</text>
  <path class="stroke" d="m${x + 153} 189 4 4 4-4" />
  <text class="detail" x="${x + 205}" y="200">Tracked setup</text>
  <rect class="subtle-fill" x="${x + 1}" y="228" width="538" height="40" />
  <path class="line" d="M${x} 228h540m-540 40h540" />
  <text class="column" x="${x + 22}" y="254">Name</text>
  <text class="column" x="${x + 306}" y="254">${detail}</text>`;
}

function render(palette) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="764" viewBox="0 0 1200 764" role="img" aria-labelledby="title description">
  <title id="title">LobeHub: a real conversion with Etymon ${evidence.etymon}</title>
  <desc id="description">Tracked setup before and after a local conversion of LobeHub ${evidence.commit}. Etymon registered ${evidence.registered.skills} skills and ${evidence.registered.rules} rules under .agents. Skill symlinks and imported instruction files were explicitly retired after verified conversion. Workflow prompts in .claude, reference documentation in .cursor, and .github CI remain tracked. Generated native setup stays local.</desc>
  <style>
    :root { ${Object.entries(palette)
      .map(([name, value]) => `--${name}: ${value};`)
      .join(' ')} }
    text { fill: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .heading { font-size: 30px; font-weight: 650; }
    .subtitle { fill: var(--muted); font-size: 20px; }
    .panel { fill: var(--panel); stroke: var(--border); }
    .subtle { fill: var(--subtle); stroke: var(--border); }
    .subtle-fill { fill: var(--subtle); }
    .line { fill: none; stroke: var(--border); }
    .stroke { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .repository { fill: var(--link); font-size: 22px; }
    .branch, .column { font-size: 19px; }
    .column { font-weight: 600; }
    .filename { font-size: 24px; }
    .detail { fill: var(--muted); font-size: 19px; }
    .retained { fill: var(--muted); }
    .success { fill: var(--success); }
    .breadcrumb { fill: var(--link); font-size: 21px; font-weight: 600; }
    .footnote { fill: var(--muted); font-size: 19px; }
  </style>
  <defs>
    <symbol id="folder" viewBox="0 0 26 26">
      <path fill="var(--folder)" d="M2 6a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v13H4a2 2 0 0 1-2-2Z" />
    </symbol>
    <symbol id="file" viewBox="0 0 26 26">
      <path class="stroke" d="M6 3h9l5 5v15H6Zm9 0v6h5M10 13h6m-6 4h6" />
    </symbol>
    <symbol id="repo" viewBox="0 0 26 26">
      <path class="stroke" d="M5 4h16v19H8a3 3 0 0 1-3-3V4Zm0 15a3 3 0 0 1 3-3h13M9 4v8" />
    </symbol>
    <symbol id="branch" viewBox="0 0 26 26">
      <g class="stroke">
        <circle cx="7" cy="5" r="2" /><circle cx="7" cy="22" r="2" /><circle cx="20" cy="5" r="2" />
        <path d="M7 7v13m0-7h6a7 7 0 0 0 7-6" />
      </g>
    </symbol>
  </defs>
  <rect width="1200" height="764" fill="var(--page)" />
  <text class="heading" x="20" y="39">Before</text>
  <text class="subtitle" x="20" y="75">Existing files and skill symlinks.</text>
  <text class="heading" x="640" y="39">With Etymon</text>
  <text class="subtitle" x="640" y="75">Portable agent source in .agents.</text>
  ${chrome(20, 'Contents')}
  ${evidence.beforeRoots.map((name, i) => row(20, 268 + i * 48, name, beforeDetails[name], name.endsWith('.md') ? 'file' : 'folder')).join('\n  ')}
  <path d="M580 402h39m-12-12 12 12-12 12" class="stroke" stroke-width="2.5" />
  ${chrome(640, 'Contents')}
  ${evidence.afterRoots.map((name, i) => row(640, 268 + i * 48, name, afterDetails[name], 'folder', name === '.agents', name !== '.agents')).join('\n  ')}
  <text class="breadcrumb" x="662" y="509">.agents / Etymon source</text>
  <path class="line" d="M640 532h540" />
  ${sources.map(([type, name, detail], i) => row(640, 532 + i * 48, name, detail, type)).join('\n  ')}
  <text class="footnote" x="600" y="749" text-anchor="middle">Local demo with Etymon ${evidence.etymon}. CI, workflow prompts and application source preserved.</text>
</svg>
`;
}

mkdirSync(output, { recursive: true });
for (const [theme, palette] of Object.entries(palettes)) {
  const filename = `agent-setup-${theme}.svg`;
  writeFileSync(new URL(filename, output), render(palette));
  console.log(`Generated docs/assets/${filename}`);
}
