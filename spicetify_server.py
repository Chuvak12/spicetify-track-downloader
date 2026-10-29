#!/usr/bin/env python3
"""
spicetify_server.py - локальный мост для расширения TrackDownloader.
Поддерживает асинхронное скачивание через spotdl и вызов системного проводника для выбора папки.
"""

import json
import os
import queue
import re
import subprocess
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 48915

# РАЗРЕШЕНИЕ ЛЮБЫХ ПАПОК:
# Если True — разрешает сохранять в любую папку на компьютере (диск D:, рабочий стол и т.д.)
# Если False — разрешает писать только в ALLOWED_ROOTS.
ALLOW_ANY_PATH = True

# Базовые папки по умолчанию
ALLOWED_ROOTS = [
    Path.home() / "Music",
    Path.home() / "Downloads"
]

STRICT_ORIGIN = True
ALLOWED_ORIGIN_HOST_SUFFIXES = ("spotify.com",)
ALLOWED_ORIGIN_SCHEMES = ("spotify", "chrome-extension")

ALLOWED_FORMATS = {"mp3", "flac", "ogg", "opus", "m4a", "wav"}
DEFAULT_FORMAT = "mp3"
SPOTDL_CMD = [sys.executable, "-m", "spotdl"]
JOB_TIMEOUT_SEC = 600
MAX_BODY_BYTES = 64 * 1024

# Регулярка для извлечения 22-символьного ID трека из spotify:track:...
TRACK_URI_RE = re.compile(r"^spotify:track:([A-Za-z0-9]{22})$")

jobs = queue.Queue()
pending_uris = set()
pending_lock = threading.Lock()


def log(message):
    line = "{:%H:%M:%S} {}".format(datetime.now(), message)
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def clean_label(value):
    return re.sub(r"[\x00-\x1f]", " ", str(value))[:100]


def origin_allowed(origin):
    if not STRICT_ORIGIN or not origin:
        return True
    parsed = urlparse(origin)
    if parsed.scheme in ALLOWED_ORIGIN_SCHEMES:
        return True
    host = parsed.hostname or ""
    return any(host == s or host.endswith("." + s) for s in ALLOWED_ORIGIN_HOST_SUFFIXES)


def resolve_target(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("targetPath is empty")
    if "{" in raw or "}" in raw:
        raise ValueError("targetPath must not contain braces")

    target = Path(os.path.expanduser(raw.strip())).resolve()

    if ALLOW_ANY_PATH:
        return target

    for root in ALLOWED_ROOTS:
        root = root.resolve()
        if target == root or root in target.parents:
            return target
    raise ValueError(f"targetPath '{target}' is outside ALLOWED_ROOTS")


def run_job(job):
    spotify_url = job["spotify_url"]
    target, fmt, label = job["target"], job["format"], job["label"]
    target.mkdir(parents=True, exist_ok=True)

    # Шаблон имени файла: Артист - Название.расширение
    template = str(target / "{artists} - {title}.{output-ext}")

    # Передаем spotdl именно URL вида https://open.spotify.com/track/...
    cmd = SPOTDL_CMD + ["download", spotify_url, "--output", template, "--format", fmt]

    log(f"[>] Downloading: {label}")
    log(f"    URL:    {spotify_url}")
    log(f"    Target: {target}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=JOB_TIMEOUT_SEC,
    )
    if result.returncode == 0:
        log(f"[ok] Finished: {label}")
    else:
        tail = (result.stderr or result.stdout or "")[-500:]
        log(f"[x] spotdl exit code {result.returncode} for {label}\n{tail}")


def worker():
    while True:
        job = jobs.get()
        try:
            run_job(job)
        except Exception as exc:
            log(f"[!] Job failed: {type(exc).__name__}: {exc}")
        finally:
            with pending_lock:
                pending_uris.discard(job["uri"])
            jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    server_version = "TrackDownloaderBridge/0.1.6"

    def log_message(self, fmt, *args):
        log(f"{self.address_string()} {fmt % args}")

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _reject_origin(self):
        origin = self.headers.get("Origin", "")
        if origin_allowed(origin):
            return False
        log(f"[!] Rejected Origin: {clean_label(origin)}")
        self._json(403, {"status": "error", "error": "origin not allowed"})
        return True

    def do_OPTIONS(self):
        if self._reject_origin():
            return
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self._reject_origin():
            return

        if self.path == "/health":
            self._json(200, {"status": "ok", "queued": jobs.qsize()})
            return

        # ЭНДПОИНТ ВЫБОРА ПАПКИ ЧЕРЕЗ СИСТЕМНОЕ ОКНО
        if self.path == "/api/v1/select-folder":
            try:
                import tkinter as tk
                from tkinter import filedialog

                # Создаем скрытое окно tkinter поверх всех окон
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                
                selected_dir = filedialog.askdirectory(title="Выберите папку для сохранения треков")
                root.destroy()

                if selected_dir:
                    log(f"[+] Folder selected via Explorer: {selected_dir}")
                    self._json(200, {"status": "ok", "path": str(Path(selected_dir).resolve())})
                else:
                    self._json(200, {"status": "cancelled"})
            except Exception as e:
                log(f"[!] File dialog error: {e}")
                self._json(500, {"status": "error", "error": str(e)})
            return

        self._json(404, {"status": "error", "error": "not found"})

    def do_POST(self):
        if self.path != "/api/v1/download":
            self._json(404, {"status": "error", "error": "not found"})
            return
        if self._reject_origin():
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(413 if length > MAX_BODY_BYTES else 400,
                       {"status": "error", "error": "invalid body size"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("track"), dict):
                raise ValueError("track object is missing")
            track = payload["track"]

            uri = track.get("uri")
            match = TRACK_URI_RE.match(uri or "")
            if not match:
                raise ValueError(f"track.uri '{uri}' is not a valid spotify:track URI")

            track_id = match.group(1)
            spotify_url = f"https://open.spotify.com/track/{track_id}"

            fmt = str(payload.get("format") or DEFAULT_FORMAT).lower()
            if fmt not in ALLOWED_FORMATS:
                raise ValueError(f"unsupported format: {clean_label(fmt)}")

            target = resolve_target(payload.get("targetPath"))
        except (ValueError, UnicodeDecodeError) as exc:
            log(f"[!] Bad request: {exc}")
            self._json(400, {"status": "error", "error": str(exc)})
            return

        with pending_lock:
            if uri in pending_uris:
                self._json(200, {"status": "duplicate", "message": "Track already in queue"})
                return
            pending_uris.add(uri)

        label = f"{clean_label(track.get('artist', '?'))} - {clean_label(track.get('name', '?'))}"
        jobs.put({
            "uri": uri,
            "spotify_url": spotify_url,
            "target": target,
            "format": fmt,
            "label": label
        })
        log(f"[+] Queued: {label}")
        self._json(202, {"status": "queued", "queued": jobs.qsize()})


def make_server(host=HOST, port=PORT):
    return ThreadingHTTPServer((host, port), Handler)


def check_spotdl():
    try:
        result = subprocess.run(SPOTDL_CMD + ["--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            log(f"spotdl version: {result.stdout.strip()}")
            return
    except Exception:
        pass
    log("[!] ВНИМАНИЕ: spotdl не найден. Установи: pip install spotdl && spotdl --download-ffmpeg")


def main():
    check_spotdl()
    threading.Thread(target=worker, daemon=True).start()
    server = make_server()
    log(f"TrackDownloader bridge listening on http://{HOST}:{PORT}")
    log(f"Allow any path: {ALLOW_ANY_PATH}")
    if not ALLOW_ANY_PATH:
        log(f"Allowed folders: {', '.join(str(r) for r in ALLOWED_ROOTS)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Сервер остановлен.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()