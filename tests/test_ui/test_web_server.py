"""Tests for the browser web frontend server helpers."""

from __future__ import annotations

from openharness.ui.web_server import WebFrontendConfig, _backend_command, _browser_host, get_web_frontend_dir


def test_web_frontend_config_defaults_ws_port_to_next_http_port() -> None:
    config = WebFrontendConfig(port=9000)

    assert config.resolved_ws_port == 9001


def test_web_frontend_config_accepts_explicit_ws_port() -> None:
    config = WebFrontendConfig(port=9000, ws_port=9443)

    assert config.resolved_ws_port == 9443


def test_browser_host_uses_loopback_for_wildcard_binds() -> None:
    assert _browser_host("0.0.0.0") == "127.0.0.1"
    assert _browser_host("::") == "127.0.0.1"


def test_backend_command_uses_existing_backend_host_flags() -> None:
    command = _backend_command(
        WebFrontendConfig(
            cwd="/tmp/demo",
            model="sonnet",
            max_turns=8,
            effort="high",
            permission_mode="default",
        )
    )

    assert command[:3] == [command[0], "-m", "openharness"]
    assert "--backend-only" in command
    assert ["--cwd", "/tmp/demo"] == command[command.index("--cwd") : command.index("--cwd") + 2]
    assert ["--model", "sonnet"] == command[command.index("--model") : command.index("--model") + 2]
    assert "--permission-mode" in command


def test_get_web_frontend_dir_finds_static_assets() -> None:
    frontend_dir = get_web_frontend_dir()

    assert (frontend_dir / "index.html").exists()
    assert (frontend_dir / "app.js").exists()
