---
name: adding-skill
description: Use when creating or updating a repository development skill or
  project rule, registering it with Etymon, and syncing contributor guidance.
---

# Authoring contributor resources

Use the repository's built CLI so registration and source creation stay in one transaction. Build current source first with npm run build. From the repo root, create a project skill with:

    node bin/etymon.js skill create --name task-name \
      --description "Use when doing a specific repository task" \
      --body-file - --yes

Pipe the Markdown body into stdin. An interactive etymon skill add with no source opens the same form. Do not use --global for contributor resources. New source belongs in .agents/etymon/skills/<name>/SKILL.md and is registered in .agents/etymon.toml; it is not an external lock dependency.

Choose a lowercase hyphenated name and a description that says when the skill applies. Include repository-specific decisions, command examples, and useful file locations. Assume the contributor can code; skip generic advice. Keep the main instructions short. If a topic needs substantial reference material, add it inside the skill bundle and link it from SKILL.md. All assets are part of the bundle identity.

For an existing skill, edit its authoritative SKILL.md or supporting files and sync. Do not edit copies under native tool folders or .agents/skills. For an existing local folder, use etymon skill add ./path/to/skill; explicit ./ keeps a missing source local. Duplicate creation must not overwrite another source.

Shared project context belongs in an always-on project rule. Create it through rule create with --dest-dir . --activation always and a stdin body. Preserve the existing project's scope when editing. Keep long task-specific workflows in skills instead of repeating them in always-on context.

Run node bin/etymon.js list --json to inspect registrations and node bin/etymon.js sync --harness <your-tools> to regenerate output. Review the plan first if existing output needs adoption. Verify the source, manifest entry, lack of new external lock dependencies, and unchanged second sync. Commit the Etymon files and source; generated output stays ignored.

Guidance may describe release or push commands, but a skill is not authorization to perform them. Follow the user's task scope. Keep human-facing contribution instructions aligned in docs/CONTRIBUTING.md.
