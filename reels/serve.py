#!/usr/bin/env python3
"""Tiny download server for the KidBus reels — forces file download on click."""
import http.server, os, shutil, socketserver

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = 8080

VIDEOS = {
    "instagram": ("KidBus-Instagram-Reel-1080x1920.mp4", "KidBus-Instagram-Reel-FullHD.mp4"),
    "linkedin": ("KidBus-LinkedIn-Video-1920x1080.mp4", "KidBus-LinkedIn-Video-FullHD.mp4"),
}

PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KidBus Reels — Download</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  body { background: #04141c; color: #f2f8fa; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 18px; }
  .card { background: #0a2f3c; border: 1px solid #1c5a6a; border-radius: 20px; padding: 28px; max-width: 460px; width: 100%; margin-bottom: 22px; text-align: center; }
  h1 { font-size: 24px; margin-bottom: 6px; }
  .brand { color: #f4a623; font-weight: 800; }
  .meta { color: #9ac2cd; font-size: 14px; margin-bottom: 18px; }
  video { width: 100%; border-radius: 12px; margin-bottom: 18px; background: #000; }
  video.tall { max-height: 420px; width: auto; max-width: 100%; margin-left: auto; margin-right: auto; display: block; }
  a.btn { display: block; background: #f4a623; color: #08222e; font-weight: 800; font-size: 18px; text-decoration: none; padding: 16px 20px; border-radius: 999px; }
  a.btn:active { transform: scale(.98); }
  .note { color: #64858f; font-size: 12px; margin-top: 10px; }
  .foot { color: #64858f; font-size: 13px; margin-top: 26px; text-align: center; }
  .foot b { color: #f4a623; }
</style></head>
<body>
  <h1 style="margin-bottom:18px">KidBus &mdash; HD Reels <span class="brand">Download</span></h1>

  <div class="card">
    <h1>Instagram Reel</h1>
    <div class="meta">Vertical 9:16 &bull; 1080&times;1920 Full HD &bull; 18.9s &bull; 4.5 MB</div>
    <video class="tall" controls playsinline preload="metadata" src="/play/instagram"></video>
    <a class="btn" href="/dl/instagram" download="KidBus-Instagram-Reel-FullHD.mp4">&#11015; Download Instagram Reel</a>
    <div class="note">Button dabate hi MP4 download ho jayegi</div>
  </div>

  <div class="card">
    <h1>LinkedIn Video</h1>
    <div class="meta">Landscape 16:9 &bull; 1920&times;1080 Full HD &bull; 19.9s &bull; 4.5 MB</div>
    <video controls playsinline preload="metadata" src="/play/linkedin"></video>
    <a class="btn" href="/dl/linkedin" download="KidBus-LinkedIn-Video-FullHD.mp4">&#11015; Download LinkedIn Video</a>
    <div class="note">Button dabate hi MP4 download ho jayegi</div>
  </div>

  <div class="foot">Built by <b>ZeroMileSystems.com</b> &bull; zeromilesystems@gmail.com</div>
</body></html>"""

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, ctype, body=b"", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _video(self, key, attach, head_only=False):
        fname, dlname = VIDEOS[key]
        path = os.path.join(BASE, fname)
        if not os.path.exists(path):
            self._send(404, "text/plain", b"not found"); return
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        if attach:
            self.send_header("Content-Disposition", f'attachment; filename="{dlname}"')
        else:
            self.send_header("Content-Disposition", f'inline; filename="{dlname}"')
        self.end_headers()
        if not head_only:
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 256)

    def do_HEAD(self):
        self._route(head_only=True)

    def do_GET(self):
        self._route(head_only=False)

    def _route(self, head_only):
        path = self.path.split("?", 1)[0].rstrip("/").lower()
        if path in ("", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if not head_only:
                self.wfile.write(body)
        elif path.startswith("/dl/"):
            key = path.rsplit("/", 1)[-1]
            if key in VIDEOS:
                self._video(key, attach=True, head_only=head_only)
            else:
                self._send(404, "text/plain", b"not found")
        elif path.startswith("/play/"):
            key = path.rsplit("/", 1)[-1]
            if key in VIDEOS:
                self._video(key, attach=False, head_only=head_only)
            else:
                self._send(404, "text/plain", b"not found")
        else:
            self._send(302, "text/plain", b"", {"Location": "/"})

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as srv:
        print(f"Serving on 0.0.0.0:{PORT}", flush=True)
        srv.serve_forever()
