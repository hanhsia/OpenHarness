# OpenHarness web frontend

A local browser frontend for OpenHarness. It serves an OpenAI-like chat layout with the field-log visual identity from `frontend/web-demo`, then forwards every browser input to the existing OpenHarness backend host over a local WebSocket bridge.

## Run

```bash
oh web
```

Useful options:

```bash
oh web --host 127.0.0.1 --port 8765 --model sonnet --permission-mode default
```

The HTTP UI runs on `--port`; the WebSocket bridge defaults to `--port + 1` unless `--ws-port` is provided.

## Behavior

- Plain prompts are submitted as normal OpenHarness turns.
- Slash commands and skill commands are handled by the existing command registry and runtime.
- Streaming assistant text, tool calls, tool results, permission prompts, edit approvals, and questions are rendered from backend protocol events.
- The default bind address is local-only to avoid exposing a harness session on the network by accident.
