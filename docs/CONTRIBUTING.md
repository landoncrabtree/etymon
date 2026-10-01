# Contributing to Etymon

Etymon keeps a team's skills, MCP settings, agents, and rules in one place. A contributor should be able to clone a repo, run `etymon sync`, and get the same setup in their own coding tools.

Help us make that work for more tools, preserve more useful settings, and make failures easier to understand. Small fixes, clear bug reports, and tests for real workflows are welcome.

## Get started

Fork or clone [landoncrabtree/etymon](https://github.com/landoncrabtree/etymon), then install the development dependencies:

```bash
npm ci
npm run build
node bin/etymon.js sync --harness codex
```

Choose the tools you use instead of `codex`, for example `claude,codex,opencode`. You can also use an installed `etymon sync`. The built CLI uses the code in your checkout.

Sync generates the project instructions and development skills. If you use a coding agent, have it read those instructions and use the relevant skills. The `coding` and `testing` skills cover everyday changes. `creating-new-interface`, `creating-new-harness`, and `resource-lifecycle` cover changes to the resource pipeline. `adding-skill` and `releasing` cover contributor guidance and package releases.

## Find your way around

| Location                                | What lives there                                                 |
| --------------------------------------- | ---------------------------------------------------------------- |
| `src/core`                              | Schemas, safe file operations, workspace state, and transactions |
| `src/providers`                         | Local and external sources, validation, and locked restoration   |
| `src/harnesses`                         | Tool profiles, native formats, import, and output                |
| `src/services`                          | Operations shared by the CLI, terminal UI, and SDK               |
| `src/cli.ts`, `src/tui`, `src/index.ts` | Commands, forms, and public exports                              |
| `tests`, `testcases`                    | Focused tests and complete CLI workflows                         |
| `docs`, `scripts`                       | References, verification evidence, and release tools             |
| `website`                               | Product site, animated demo, and browser tests                   |

The [architecture reference](ARCHITECTURE.md) has the full module map. [Rule compatibility](RULES.md) records supported locations and scopes.

## Make a change

Describe the problem and the behavior you want to change. For bugs, include the command, tool version, and relevant output from `etymon doctor --json`. Remove credentials before sharing logs.

Keep command and form behavior in shared services. Native output goes through the ownership planner, so existing settings, manual edits, and recovery still work. When adding a tool, check its current primary documentation or source and include the links in its profile. Preserve permissions and rule conditions by default. Explicit lossy conversion must name each changed behavior or omitted resource, keep the authored source intact, and retain validation and ownership checks.

The files we share are `.agents/etymon.toml`, `.agents/etymon.lock`, and authored source under `.agents/etymon/`. Edit those sources and sync to regenerate tool files. Generated copies stay out of Git. Create a new contributor skill with `etymon skill create`; use `etymon rule create` for shared project guidance.

## Check your work

Run focused tests while developing, then:

```bash
npm run check
```

For resource workflows, add or update a numbered [test scenario](../testcases/README.md). These run the actual CLI in temporary Git repos and isolate user settings. Check the resulting files and a second sync with no changes.

```bash
./test_harness.sh 2 7
npm run test:coverage
```

Coverage includes unit tests and CLI scenarios. The minimums are 70% lines/statements, 65% branches, and 80% functions. Use useful assertions rather than changing the thresholds to fit a patch.

Changes to packaging should pass `npm run smoke`. Native loader changes should be checked against the installed tool where possible. Those checks inspect skills, settings, and instructions without model requests or account credentials. Say which checks ran and what they establish; editor configuration tests do not prove an editor loaded the files.

For the product site, see [website/README.md](../website/README.md). Run its format check, Astro check, production build, and browser tests. Keep tool support tied to the CLI profiles. Check both themes, keyboard controls, reduced motion, and mobile layouts.

## Send a pull request

Explain the concrete problem, the resulting behavior, and how you tested it. Include any conversion limits or required native settings that a reviewer needs to assess the change. Keep unrelated edits out of the patch.

Use conventional commit types such as `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, and `chore`.

If an agent contributed substantial code, identify it honestly. For example:

```text
feat: add scoped rule creation [codex]

Agent-assisted-by: Codex
```

Describe your review and testing without claiming generated code was entirely human-written. You are responsible for the changes you submit.

Releases use `scripts/npm_build.sh` to choose the next version from npm and create a tarball. `scripts/npm_publish` publishes the reviewed archive separately. The release skill explains the checks and version rules; contribution guidance does not authorize a release.
