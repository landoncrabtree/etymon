# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated in the website brief: Astro static output, deployed with GitHub Pages. The Etymon CLI remains a separate Node.js package.

## Users

Developers and repository contributors who use different coding agents and need to share repository guidance and configuration.

## Product Purpose

Etymon keeps coding-agent setup portable. Teams author one manifest, lock external resources, and generate each tool's native files with `etymon sync`.

## Positioning

Replace tool-specific setup with `.agents/etymon.toml`, `.agents/etymon.lock`, and authored resources. A contributor can use their preferred tool with the same shared repository setup.

## Operating Context

New repositories use `etymon init`, add or create resources, then sync. Existing repositories import native configuration with `etymon convert <harness>`, then sync to another destination. Both global and project scopes exist.

## Capabilities and Constraints

- Four interfaces: skills, MCP connections, agents, and rules/instructions.
- Nineteen destination profiles with different interface and conversion support; see `docs/CLI.md` and `docs/RULES.md`.
- Sources include local files, Git repositories, skills.sh, and the MCP Registry.
- External resources use locked versions. Native output is generated; authored source remains editable.
- Compatibility varies. Strict conversion blocks unsupported semantics; `--allow-lossy` permits warned adaptations.
- Conversion keeps the original files. Visual demonstrations must not imply automatic deletion.
- Installation: `npm install -g etymon` or `npx etymon`. Node.js 22+; Git for repository sources.
- The website is a static product showcase, not an account-based service. No pricing, customer endorsements, or usage metrics have been supplied.

## Brand Commitments

The user requested clean, modern, minimalist product copy and expressive motion. Avoid cyberpunk styling, hacker-terminal aesthetics, inflated AI language, and lengthy explanations. Use a large hero, a copyable `npx etymon` command, concise interface/tool support, and an icon-only GitHub link in a sticky header.

## Evidence on Hand

`README.md`, `docs/CLI.md`, `docs/RULES.md`, and the CLI source document capabilities. `testcases/` verifies actual conversion, synchronization, and resource workflows. GitHub: https://github.com/landoncrabtree/etymon. License: MIT, recorded in `LICENSE`.

## Product Principles

- Show concrete commands and file outcomes.
- Keep shared source authoritative and generated files disposable.
- State supported formats without implying identical capabilities everywhere.
- Let visitors try the product without an account or sales conversation.

## Open Decisions

No existing logo or visual identity was supplied. The user confirmed system light/dark themes with a navbar toggle and requested image mockups before implementation. No existing logo was supplied.
