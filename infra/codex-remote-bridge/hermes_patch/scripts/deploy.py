#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy Hermes mobile Codex patch.")
    parser.add_argument("--host", required=True, help="SSH host, for example root@43.136.80.19")
    parser.add_argument("--key", required=True, help="SSH private key path")
    parser.add_argument("--service", default="hermes-gateway.service", help="Remote systemd service to restart")
    parser.add_argument("--no-restart", action="store_true", help="Upload and syntax-check without restarting Hermes")
    args = parser.parse_args()

    key = str(pathlib.Path(args.key).expanduser())
    ssh = ["ssh", "-i", key, "-o", "BatchMode=yes", args.host]
    scp = ["scp", "-i", key, "-o", "BatchMode=yes"]
    uploads = [
        (ROOT / "gateway" / "mobile_orchestration.py", "/root/.hermes/core/gateway/mobile_orchestration.py"),
        (ROOT / "scripts" / "apply_remote_patch.py", "/tmp/codex_mobile_apply_remote_patch.py"),
    ]
    for local, remote in uploads:
        subprocess.run(scp + [str(local), f"{args.host}:{remote}"], check=True)

    subprocess.run(ssh + ["/root/.hermes/core/venv/bin/python /tmp/codex_mobile_apply_remote_patch.py"], check=True)
    subprocess.run(
        ssh
        + [
            "/root/.hermes/core/venv/bin/python -m py_compile "
            "/root/.hermes/core/gateway/codex_bridge.py "
            "/root/.hermes/core/gateway/mobile_orchestration.py "
            "/root/.hermes/core/gateway/platforms/wecom.py"
        ],
        check=True,
    )
    if not args.no_restart:
        subprocess.run(ssh + [f"systemctl restart {args.service} && sleep 2 && systemctl is-active {args.service}"], check=True)
    print("Hermes mobile Codex patch deployed and syntax-checked.")


if __name__ == "__main__":
    main()
