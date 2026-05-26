# OpenHarness — Web UI demo (static)

A single static page that mocks the planned Light v2 web UI. It contains
**no functionality** — just a visual reference so we can iterate on the
look and feel before building the real frontend.

## Run

Just open the file in a browser:

```
frontend/web-demo/index.html
```

No build step, no dependencies.

## What it shows

- App shell: left sidebar (sessions) + main pane + status bar
- Welcome state with example chips (no large suggestion cards)
- A user message and an assistant reply with two tool-call cards
- A small diff preview (GitHub-style colors)
- Inline permission bar (Deny / Allow once / Allow always)
- Slash-command popover above the composer
- Composer with primary "Send" button and keyboard hints
- Status bar with model / tokens / cost in mono

## Design intent (anti-AI-slop)

- Light by default; near-black `--accent` instead of brand gradients
- Neutral palette; one cool blue for links only
- 1px borders instead of shadows for separation
- 6–8px radii, no glow / neon / glass
- Lucide-style line icons, no emoji in chrome
- System font stack for UI, mono for tool names / paths / metrics

## Theming hook (dark-ready)

All colors are CSS variables in `:root` / `[data-theme="light"]`. A second
`[data-theme="dark"]` block exists with placeholder values, and a tiny
switcher in the header toggles `data-theme` on `<html>` and persists to
`localStorage` under `oh.theme`. The dark surface is intentionally just
"functional, not finished" — it proves the hook works without committing
to a dark design yet.

When we are ready to ship dark for real, the only change required is to
update the values in the `[data-theme="dark"]` block. No component code
needs to know about theme.
