---
name: Etymon website
description: A minimal product site with a readable, controllable workflow demonstration.
colors:
  bg-light: '#fafaf8'
  surface-light: '#f2f2ef'
  panel-light: '#ffffff'
  soft-light: '#ededeb'
  text-light: '#222426'
  muted-light: '#62666b'
  line-light: '#d5d6d3'
  accent-light: '#b74013'
  accent-fill: '#f87947'
  on-accent: '#202225'
  green-light: '#36754c'
  folder-light: '#33728e'
  bg-dark: '#14191b'
  surface-dark: '#1b2123'
  panel-dark: '#1b2226'
  soft-dark: '#262a2e'
  text-dark: '#f8f8f6'
  muted-dark: '#a3a8ae'
  line-dark: '#383e43'
  accent-dark: '#f87947'
  green-dark: '#93bda2'
  terminal-dark: '#111719'
  finder-dark: '#1b2226'
  output-dark: '#141b1e'
  folder-dark: '#7bb7d0'
typography:
  display:
    fontFamily: '"Encode Sans Expanded", sans-serif'
    fontSize: 'clamp(56px, 6.12vw, 94px)'
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: '-0.04em'
  headline:
    fontFamily: '"Encode Sans Expanded", sans-serif'
    fontSize: 'clamp(31px, 3.3vw, 50px)'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '-0.04em'
  title:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: '22px'
    fontWeight: 600
    letterSpacing: '-0.04em'
  body:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: '14px'
    fontWeight: 600
  code:
    fontFamily: '"JetBrains Mono Variable", monospace'
    fontSize: 'clamp(11px, 1vw, 15px)'
    fontWeight: 400
    lineHeight: 1.6
  command:
    fontFamily: '"JetBrains Mono Variable", monospace'
    fontSize: '17px'
    fontWeight: 400
    letterSpacing: '-0.035em'
rounded:
  tag: '4px'
  inset-control: '5px'
  native-file: '7px'
  theme-group: '8px'
  workspace: '9px'
  stage: '12px'
  scene-tab: '28px'
  scene-group: '40px'
spacing:
  control-inset: '7px'
  icon-gap: '12px'
  section-heading-gap: '24px'
  interface-gap: '44px'
  section-start: '76px'
  section-end: '84px'
  section-mobile: '48px'
components:
  copy-command:
    backgroundColor: '{colors.accent-fill}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.workspace}'
    padding: '10px 10px 10px 18px'
    width: '260px'
  command-input:
    typography: '{typography.command}'
    padding: '6px 0'
  theme-choice:
    rounded: '{rounded.inset-control}'
    height: '44px'
    width: '44px'
  scene-tab:
    rounded: '{rounded.scene-tab}'
    padding: '10px 24px'
  scene-tab-selected:
    backgroundColor: '{colors.accent-fill}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.scene-tab}'
    padding: '10px 24px'
  playback:
    rounded: '{rounded.native-file}'
    height: '44px'
    width: '44px'
  native-file:
    rounded: '{rounded.native-file}'
    padding: '10px 14px'
  source-tag:
    rounded: '{rounded.tag}'
    padding: '3px 7px'
---

# Design System: Etymon website

## Overview

**Creative North Star: "Minimal product studio"**

The website uses broad display type, quiet neutral surfaces, and one orange accent. Commands and file paths give it its developer character. The approved direction is clean, modern, and restrained, with no cyberpunk or hacker styling.

The workflow demonstration is built from text, SVG, CSS, and an authored timeline. Motion explains commands and file outcomes while leaving visitors in control. This record describes the website; it does not define the CLI or terminal UI. Product claims remain in [PRODUCT.md](PRODUCT.md).

**Key Characteristics:**

- Broad display lettering paired with readable UI text and code.
- Light and dark neutral surfaces with orange actions and connections.
- Flat, bordered UI chrome with modest corners.
- Controllable motion and completed scenes for reduced motion.

Extracted from [site.css](website/src/styles/site.css), [Layout.astro](website/src/layouts/Layout.astro), the website components, and [site.ts](website/src/scripts/site.ts). The approved composition is [.impeccable/mocks/website-b.png](.impeccable/mocks/website-b.png); its sidecar records the user's selection. The original direction named Manrope for display text; the final implementation uses Encode Sans Expanded for headings and Manrope for UI text.

## Colors

Warm near-white or charcoal backgrounds keep the orange accent readable. The frontmatter records the exact CSS values for each theme; the sidecar maps them to the source custom properties.

### Primary

- **Orange text accent:** The light variant carries readable commands, links, icons, and focus outlines. The dark variant brightens those same roles.
- **Orange action fill:** Copy fields and selected demo tabs share this fill in both themes. Charcoal on-accent text keeps those filled controls legible.

### Neutral

- **Page background:** The light and dark background tokens set the full-page canvas.
- **Section surface:** The quieter inset layer separates the demonstration and shared-source section.
- **Panel and soft surface:** Panels hold native files and UI chrome; soft surfaces identify selected theme controls and hovered neutral controls.
- **Text and muted text:** Main text carries headings and file names; muted text carries explanations, metadata, and inactive controls.
- **Line:** Thin borders separate windows, sections, and lists in both themes.
- **Dark terminal, Finder, and output surfaces:** Distinct dark layers separate the command pane, shared file tree, and native file outputs. Light mode falls back to its panel surface.

Green checks and blue folder icons are functional status and file-type cues inside the demonstration. They do not form additional brand accents.

**The Orange Action Rule.** Use the action fill with on-accent charcoal text. Use the theme's text accent for small orange text and outlines.

## Typography

**Display Font:** Encode Sans Expanded, with sans-serif fallback. The bundled display face is weight 700.

**Body Font:** Manrope Variable, with sans-serif fallback.

**Label/Mono Font:** JetBrains Mono Variable, with monospace fallback, for commands and file paths.

The expanded headings give the page its broad silhouette. Manrope keeps explanations and navigation compact; the monospace face makes commands and source paths easy to identify.

### Hierarchy

- **Display:** The hero uses the display token. At the 1280px breakpoint its size becomes `6.35vw`; at 1000px, `8.4vw`; at 640px, `8.9vw` with line height `1.12`.
- **Headline:** Section headings use the headline token.
- **Title:** Interface names use the title token, reducing to `19px` on mobile.
- **Body:** Shared-section paragraphs use the body token. Hero support copy uses `19px` and line height `1.6`, reducing to `15px` at 1280px. Other explanations use `14px` to `16px` according to context.
- **Label:** Navigation uses the label token; small file metadata and explanatory labels range from `10px` to `12px`.
- **Code:** Terminal and file-tree text use the code token. At 1000px they become `13px`; at 640px they become `11px`. Native file names reduce further within compact mobile output cells.

**The Readable Tracking Rule.** Display headings use `-0.04em` tracking. Do not tighten display tracking below that value.

## Layout

The regular content container is capped at `1416px` with `56px` side gutters. The demonstration container is capped at `1456px` with `36px` gutters. The sticky header is `72px` tall. Desktop sections use the frontmatter's section spacing; white space and thin rules separate content rather than a page-wide card grid.

The hero pairs a `1.67fr 1fr` grid with a `48px` gap. The panoramic demonstration pairs a `1.875fr 1fr` workspace/output grid; its workspace divides terminal and Finder at `1.65fr 1fr`. The interface index uses four columns with the recorded interface gap. Shared-source and getting-started sections use two columns.

At `1280px`, regular gutters become `40px`, demonstration gutters become `24px`, and the hero and section gaps tighten. At `1000px`, the hero and shared-source section stack, interface content becomes two columns, and three native outputs sit below the workspace; connector lines are hidden. At `640px`, regular gutters become `20px`, demonstration gutters become `12px`, the header becomes `68px`, and sections use the mobile spacing token. Terminal and Finder stack, demo controls return to normal document flow, and getting-started content becomes one column. At `360px`, the navbar hides the wordmark text and the command/link row wraps. The page's minimum width is `320px`.

## Elevation & Depth

The shipped stylesheet uses no box shadows. Depth comes from tonal surfaces, a single-pixel border, divided window panes, and overlapping desktop demo controls. The light and dark palettes retain these same roles. Focus is explicit: a `2px` accent outline with `5px` offset, using charcoal inside the orange copy field.

**The Flat Surface Rule.** Separate adjacent surfaces with their tone and border; preserve the quiet depth of the existing windows and lists.

## Shapes

Window and command corners use the workspace radius. Native file cells and the playback control share their smaller radius; the broad demo stage uses the stage radius and reduces to the workspace radius on mobile. Theme choices sit inside a rounded group. Scene controls use pill-shaped tabs inside a pill group. Source tags have the smallest corners. These are distinct component shapes, not a universal card treatment.

Icons and connector paths are inline SVG. Window status dots are small circular UI details. The shipped page has no raster plates.

## Components

### Copy command

An orange command field with a real read-only input and a separate copy control. Its desktop shape, fill, width, and inset are recorded in frontmatter; the input uses `17px` monospace text and `-0.035em` tracking. At 1280px the wrapper is `235px` wide and at 640px it is `212px`, with `15px` input text. The button is normally `44px` square and becomes `40px` wide on mobile.

Copy success replaces the icon with a check and announces “Command copied.” for `2400ms`. Clipboard failure focuses and selects the input with a keyboard-copy instruction. Without JavaScript, the input remains selectable and the copy control is hidden. Hover adds a faint charcoal tint; keyboard focus uses the explicit outline.

### Navigation and theme choices

The sticky navigation uses a wordmark, concise anchor links, three icon-only theme choices, and an icon-only GitHub link. Theme buttons are `44px` square and mark selection with `aria-pressed`, a soft background, and foreground text. System preference is the default; an explicit light or dark choice persists when local storage is available. System changes update the page only while System is selected. Theme selection is applied before page paint. On mobile, navigation anchors hide while theme and GitHub controls stay visible.

### Text links

Guide and reference links use UI text with inline SVG arrows. Hover changes the text to the theme accent over `160ms`. The hero guide link is underlined with a `6px` offset. Focus stays visible independently of hover.

### Native file cells and source tags

Native outputs are compact bordered cells with a file icon, monospace path, and muted detail. They use the output surface in dark mode and the panel surface in light mode. The source tag is a small bordered monospace label inside the Finder toolbar. These describe files and provenance; they are not interactive feature cards.

### Workflow scene controls

Four tabs select `init`, `convert`, `sync`, and `skills add`; the selected tab uses orange fill with charcoal text. Arrow keys, Home, and End move selection and focus. Selection kills the running timeline, completes the requested scene, and leaves playback paused. The separate playback button is `44px` square and carries an updated accessible label. Mobile tab controls drop their icons to keep the command labels readable.

### Signature workflow demonstration

One GSAP timeline types the current command, reveals status lines, replaces the file-tree state, draws connectors, reveals native outputs, and shows completion before the next scene. Typing uses linear easing; the following effects use `expo.out`. Timings and stagger values are recorded in the sidecar. Commands, tab labels, paths, and output descriptions come from the same scene data.

Playback pauses while the demo is hovered, relevant content has focus, the page is hidden, or the demo is offscreen. A visitor's pause and manual scene choice also stop autoplay. With reduced motion, scenes are already complete and playback advances to the next completed scene without typing or spatial effects. The static fallback shows the completed sync scene. Accessible text describes each command and outcome outside the decorative diagram.

## Do's and Don'ts

### Do:

- **Do** use the theme's semantic surface, text, line, and accent roles.
- **Do** keep orange filled controls paired with on-accent charcoal text.
- **Do** preserve display tracking at or above `-0.04em`.
- **Do** keep real commands and paths in the bundled monospace face.
- **Do** keep the demo controllable and render completed scenes for reduced motion.
- **Do** use short, concrete product copy and preserve the factual labels on illustrative demonstrations.

### Don't:

- **Don't** introduce neon, cyberpunk, or hacker styling.
- **Don't** use raster plates in place of the editable text, SVG, and CSS demonstration.
- **Don't** imply that conversion deletes original files or that every tool supports identical capabilities.
- **Don't** add invented endorsements, usage metrics, or pricing.
- **Don't** use em dashes in product copy.

Documentation records the current implementation, not a completed process tracker. Build checks and captures are recorded in [.impeccable/review/build-evidence.json](.impeccable/review/build-evidence.json). The five visual review fixes are resolved. The bounded review remains `fix` solely because the tracker requires a separate component-review receipt while its phase remains `plates`, despite zero plates and an approved full composition. No receipt or phase completion is implied by this document.
