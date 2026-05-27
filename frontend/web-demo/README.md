# OpenHarness — Web UI demo (static)

A single static page that mocks a candidate UI for OpenHarness. It contains
**no functionality** — just a visual reference so we can iterate on the
look and feel before building the real frontend.

> **TODO — stale previews.** The `preview-light.png` / `preview-dark.png`
> screenshots in this folder were captured against the previous neutral-grey
> mock and **no longer match the page**. Regenerate both (new file names:
> `preview-paper.png`, `preview-ink.png`) once this direction is approved,
> and update the table below to reference them.

## Run

Just open the file in a browser:

```
frontend/web-demo/index.html
```

No build step, no dependencies.

## Design direction — "field log"

The brief was explicit: **the UI should not have a generic face.** The
previous mock was clean but it was also the same three-pane, neutral-grey,
1-px-bordered shell every AI tool ships. This pass commits to an identity
instead of avoiding one.

The metaphor is a printed **field log** — a working transcript between
you and the harness, recorded in order, with nothing hidden.

Choices that make the surface its own thing, not the default:

- **Celadon paper, deep ink.** A cool celadon (青瓷) `--paper` with a
  green-tinted ink — not the cream / beige that AI tools have made the
  current cliché, and not the industry-standard cool white + neutral
  grey either. A single **oxblood** accent (青瓷 + 朱砂, a classic
  Chinese ceramic pairing) is the only saturated color on the page,
  and it appears sparingly (wordmark separator, section numbers, the
  `❯` composer sigil, permission asks).
- **Three typefaces, three jobs.** Serif (Iowan Old Style / Charter)
  carries the prose voice. A clean sans (Segoe UI / system-ui) is
  reserved for chrome (header, buttons, hints). Mono (JetBrains Mono
  / Cascadia Code) is reserved for structural data (paths, tool
  names, diffs). Most AI tools use a single sans for everything; the
  contrast here is part of the identity. **Every stack carries CJK
  fallbacks** (PingFang SC / Microsoft YaHei / Source Han / Noto CJK
  / Sarasa Mono) so 中文 / 日本語 / 한글 render in the matching weight
  instead of dropping to a generic sans.
- **No sidebar.** The chat-list-on-the-left pattern is the strongest
  cliché in this product category, so it is gone. The current session is
  named in the masthead; switching sessions is a dropdown affordance,
  not a permanent rail.
- **Numbered entries in a gutter.** Each conversation turn is a "§ NN"
  entry with the section number hung in a left gutter, like marginalia
  in a printed page. The first user turn even gets a drop-cap.
- **Ruled paper background.** The body has faint horizontal rules at the
  baseline grid, the way a notebook page does. It is subtle but it
  makes the surface feel like a physical artifact, not a SaaS dashboard.
- **Tool calls as marginalia.** Tool invocations are not cards. They are
  indented mono notes with a thin ink rail on the left and a small
  uppercase annotation (e.g. `· 7 matches`) at the end of the line.
- **Diffs without GitHub flood.** No green / red row backgrounds. A left
  ink rail, line numbers, and `+` / `−` sigils carry the meaning;
  removed lines use a strikethrough.
- **Permission asks as prose.** The permission request is a sentence
  with three text-link choices — not a three-button bar — and the
  destructive ("session-wide") option is *not* the visually loudest one.
- **Composer is one line of type.** A serif input with a leading `❯`
  prompt sigil. No surrounding panel. Send is a text link, not a
  filled button.
- **Two real themes, both first-class.** `paper` (default) and `ink`
  (a true "midnight ledger" — same identity, recoloured). There is no
  placeholder / disabled theme button in the chrome.

What was deliberately **removed** from the previous mock because it read
as "generic AI tool":

- left sidebar with session history
- example chips on the empty state
- per-message model byline next to every assistant turn
- `$0.041` / `12,840 tok` status bar
- the green "connected" pill
- the blinking caret on streaming text
- the disabled "System" theme button

## Theming

Themes are CSS variables on `[data-theme="paper"]` (default) and
`[data-theme="ink"]`. The toggle in the masthead flips between them and
persists the choice to `localStorage` under `oh.theme`. Adding a future
theme is one new variable block.
