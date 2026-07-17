#!/usr/bin/env python3
"""Design preview — writes content to the Vite project, starts dev server.

Usage:
  # Design doc only
  python3 preview.py design.md --title "System Design" --mode architecture

  # UI mode with live component preview
  python3 preview.py design.md --ui-html components.html --title "Dashboard UI" --mode ui
"""
import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import date

PROJECT_DIR = os.path.expanduser("~/.claude/design")
CONTENT_DIR = os.path.join(PROJECT_DIR, "public", "content")
PID_FILE = os.path.join(PROJECT_DIR, ".dev-server.pid")


def find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def kill_previous_server() -> None:
    if not os.path.exists(PID_FILE):
        return
    try:
        pid = int(open(PID_FILE).read().strip())
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.3)
    except (ProcessLookupError, ValueError, OSError):
        pass


def is_server_running():
    """Return port if dev server is already running, else None."""
    if not os.path.exists(PID_FILE):
        return None
    try:
        pid = int(open(PID_FILE).read().strip())
        os.kill(pid, 0)  # check alive
        port_file = PID_FILE + ".port"
        if os.path.exists(port_file):
            return int(open(port_file).read().strip())
    except (ProcessLookupError, ValueError, OSError):
        pass
    return None


def parse_variant(spec: str):
    """Parse 'Label:path/to/file.html' into (label, path)."""
    if ":" not in spec:
        return os.path.basename(spec), spec
    label, path = spec.split(":", 1)
    return label.strip(), path.strip()


def write_content(args: argparse.Namespace) -> None:
    os.makedirs(CONTENT_DIR, exist_ok=True)

    shutil.copy2(args.markdown_file, os.path.join(CONTENT_DIR, "doc.md"))

    variants = []
    has_ui = False

    if args.variant:
        for i, spec in enumerate(args.variant):
            label, path = parse_variant(spec)
            if not os.path.exists(path):
                print(f"Warning: variant file not found: {path}", file=sys.stderr)
                continue
            fname = f"ui-{chr(97 + i)}.html"
            shutil.copy2(path, os.path.join(CONTENT_DIR, fname))
            variants.append({"id": chr(97 + i), "label": label, "file": fname})
        has_ui = len(variants) > 0
    elif args.ui_html and os.path.exists(args.ui_html):
        shutil.copy2(args.ui_html, os.path.join(CONTENT_DIR, "ui.html"))
        has_ui = True

    for old in os.listdir(CONTENT_DIR):
        if old.startswith("ui-") and old.endswith(".html") and not variants:
            os.remove(os.path.join(CONTENT_DIR, old))

    meta = {
        "title": args.title,
        "mode": args.mode,
        "date": args.date,
        "hasUi": has_ui,
    }
    if variants:
        meta["variants"] = variants
    with open(os.path.join(CONTENT_DIR, "meta.json"), "w") as f:
        json.dump(meta, f)


def start_dev_server() -> tuple[int, int]:
    port = find_free_port()
    proc = subprocess.Popen(
        ["npx", "vite", "--port", str(port), "--host", "localhost", "--strictPort"],
        cwd=PROJECT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))
    with open(PID_FILE + ".port", "w") as f:
        f.write(str(port))
    return proc.pid, port


def main() -> None:
    parser = argparse.ArgumentParser(description="Design preview generator")
    parser.add_argument("markdown_file", help="Design document markdown file")
    parser.add_argument("--ui-html", help="Single UI HTML file for live preview")
    parser.add_argument("--variant", action="append", help="'Label:file.html' — repeatable for multi-option comparison")
    parser.add_argument("--title", default="Design Preview")
    parser.add_argument("--mode", default="architecture",
                        choices=["architecture", "api", "database", "system", "module", "ui"])
    parser.add_argument("--date", default=str(date.today()))
    parser.add_argument("--no-open", action="store_true", help="Skip opening browser")
    args = parser.parse_args()

    for path, label in [(args.markdown_file, "markdown")]:
        if not os.path.exists(path):
            print(f"Error: {label} not found at {path}", file=sys.stderr)
            sys.exit(1)

    write_content(args)

    existing_port = is_server_running()
    if existing_port:
        url = f"http://localhost:{existing_port}"
        print(f"{url}  (server already running, content updated — refresh browser)")
    else:
        pid, port = start_dev_server()
        time.sleep(1.5)
        url = f"http://localhost:{port}"
        print(url)
        print(f"PID:{pid}")

    if not args.no_open:
        if sys.platform == "darwin":
            subprocess.run(["open", url], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", url], check=False)


if __name__ == "__main__":
    main()
