# Serves this folder on http://localhost:8322 with caching switched off,
# so the browser always runs the latest version of the game.
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8322
print(f"Machines in Masquerade: http://localhost:{port}/  (close this window to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=ROOT)).serve_forever()
