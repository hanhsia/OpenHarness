"""Local web frontend server for OpenHarness."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
import threading
import webbrowser
from dataclasses import dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from openharness.ui.protocol import FrontendRequest
from openharness.ui.react_launcher import build_backend_command

log = logging.getLogger(__name__)

_PROTOCOL_PREFIX = "OHJSON:"
_PROCESS_TERMINATE_TIMEOUT_SECONDS = 3


@dataclass(frozen=True)
class WebFrontendConfig:
    """Configuration for the local web frontend host."""

    host: str = "127.0.0.1"
    port: int = 8765
    ws_port: int | None = None
    cwd: str | None = None
    model: str | None = None
    max_turns: int | None = None
    effort: str | None = None
    base_url: str | None = None
    system_prompt: str | None = None
    api_key: str | None = None
    api_format: str | None = None
    permission_mode: str | None = None
    open_browser: bool = True

    @property
    def resolved_ws_port(self) -> int:
        """Return the websocket port, defaulting to the HTTP port + 1."""

        return self.ws_port if self.ws_port is not None else self.port + 1


def get_web_frontend_dir() -> Path:
    """Return the bundled or checkout-local web frontend directory."""

    pkg_frontend = Path(__file__).resolve().parent.parent / "_web_frontend"
    if (pkg_frontend / "index.html").exists():
        return pkg_frontend

    repo_root = Path(__file__).resolve().parents[3]
    dev_frontend = repo_root / "frontend" / "web"
    if (dev_frontend / "index.html").exists():
        return dev_frontend

    return pkg_frontend


def _browser_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return host.strip("[]") if ":" in host else host


def _make_http_handler(static_dir: Path, config: WebFrontendConfig) -> type[SimpleHTTPRequestHandler]:
    class WebHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(static_dir), **kwargs)

        def log_message(self, format_str: str, *args: Any) -> None:
            log.debug("web frontend: " + format_str, *args)

        def do_GET(self) -> None:  # noqa: N802
            if self.path.split("?", 1)[0] == "/config.js":
                payload = {
                    "wsPort": config.resolved_ws_port,
                    "wsPath": "/ws",
                    "cwd": config.cwd or os.getcwd(),
                }
                body = "window.OPENHARNESS_WEB_CONFIG = " + json.dumps(payload) + ";\n"
                encoded = body.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(encoded)
                return
            if self.path in {"", "/"}:
                self.path = "/index.html"
            super().do_GET()

    return WebHandler


def _backend_command(config: WebFrontendConfig) -> list[str]:
    return build_backend_command(
        cwd=config.cwd or os.getcwd(),
        model=config.model,
        max_turns=config.max_turns,
        effort=config.effort,
        base_url=config.base_url,
        system_prompt=config.system_prompt,
        api_key=config.api_key,
        api_format=config.api_format,
        permission_mode=config.permission_mode,
    )


async def _send_json(websocket: Any, payload: dict[str, Any]) -> None:
    await websocket.send(json.dumps(payload, ensure_ascii=False))


async def _pipe_backend_stdout(websocket: Any, process: asyncio.subprocess.Process) -> None:
    assert process.stdout is not None
    while True:
        raw = await process.stdout.readline()
        if not raw:
            return
        line = raw.decode("utf-8", errors="replace").rstrip("\n")
        if line.startswith(_PROTOCOL_PREFIX):
            await websocket.send(line[len(_PROTOCOL_PREFIX) :])
        elif line.strip():
            await _send_json(websocket, {"type": "transcript_item", "item": {"role": "log", "text": line}})


async def _pipe_backend_stderr(websocket: Any, process: asyncio.subprocess.Process) -> None:
    assert process.stderr is not None
    while True:
        raw = await process.stderr.readline()
        if not raw:
            return
        line = raw.decode("utf-8", errors="replace").rstrip("\n")
        if line.strip():
            await _send_json(websocket, {"type": "transcript_item", "item": {"role": "log", "text": line}})


async def _handle_websocket(websocket: Any, config: WebFrontendConfig) -> None:
    command = _backend_command(config)
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_task = asyncio.create_task(_pipe_backend_stdout(websocket, process))
    stderr_task = asyncio.create_task(_pipe_backend_stderr(websocket, process))
    try:
        async for message in websocket:
            if not isinstance(message, str):
                await _send_json(websocket, {"type": "error", "message": "Binary websocket frames are not supported"})
                continue
            try:
                FrontendRequest.model_validate_json(message)
            except Exception as exc:
                await _send_json(websocket, {"type": "error", "message": f"Invalid request: {exc}"})
                continue
            if process.stdin is None or process.stdin.is_closing():
                await _send_json(websocket, {"type": "error", "message": "Backend is not accepting input"})
                continue
            process.stdin.write(message.encode("utf-8") + b"\n")
            await process.stdin.drain()
    finally:
        if process.stdin is not None and not process.stdin.is_closing():
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                process.stdin.write(b'{"type":"shutdown"}\n')
                await process.stdin.drain()
                process.stdin.close()
        await _terminate_process(process)
        stdout_task.cancel()
        stderr_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stdout_task
        with contextlib.suppress(asyncio.CancelledError):
            await stderr_task


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=_PROCESS_TERMINATE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


async def run_web_frontend(config: WebFrontendConfig) -> int:
    """Serve the browser UI and a websocket bridge to the OpenHarness backend."""

    from websockets.asyncio.server import serve

    static_dir = get_web_frontend_dir()
    if not (static_dir / "index.html").exists():
        raise RuntimeError(f"Web frontend is missing: {static_dir / 'index.html'}")

    httpd = ThreadingHTTPServer((config.host, config.port), _make_http_handler(static_dir, config))
    http_thread = threading.Thread(target=httpd.serve_forever, name="openharness-web-http", daemon=True)
    http_thread.start()

    url = f"http://{_browser_host(config.host)}:{config.port}"
    print(f"OpenHarness web frontend: {url}")
    print(f"WebSocket bridge: ws://{_browser_host(config.host)}:{config.resolved_ws_port}/ws")
    if config.host not in {"127.0.0.1", "localhost", "::1"}:
        print("Warning: non-local bind addresses can expose this harness session on your network.", file=sys.stderr)
    if config.open_browser:
        webbrowser.open(url)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signame in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, signame, None)
        if sig is None:
            continue
        with contextlib.suppress(NotImplementedError, RuntimeError):
            loop.add_signal_handler(sig, stop.set)

    try:
        async with serve(
            partial(_handle_websocket, config=config),
            config.host,
            config.resolved_ws_port,
            max_size=8 * 1024 * 1024,
        ):
            await stop.wait()
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


__all__ = ["WebFrontendConfig", "get_web_frontend_dir", "run_web_frontend"]
