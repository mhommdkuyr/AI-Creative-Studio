import os
from http.server import BaseHTTPRequestHandler, HTTPServer

VIDEO_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_30Qx9tWAprEzrz9cJKO51812Ejq/41205a8b-8802-484c-b6cd-3d4891b088f6.mp4"

HTML = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Little Fox & The Magic Balloon</title>
<style>body{{margin:0;background:#eaf9ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}}main{{width:min(94vw,520px);text-align:center}}video{{width:100%;max-height:78vh;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.18);background:#000}}a{{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:12px;background:#111;color:#fff;text-decoration:none}}h1{{font-size:24px}}p{{color:#555}}</style></head>
<body><main><h1>🦊 Little Fox & The Magic Balloon 🎈</h1><p>First children's Short — vertical 9:16</p><video controls playsinline preload="metadata" src="{VIDEO_URL}"></video><br><a href="{VIDEO_URL}" download>Open / Save MP4</a></main></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            data = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif self.path == "/health":
            data=b"ok"
            self.send_response(200)
            self.send_header("Content-Type","text/plain")
            self.send_header("Content-Length",str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404); self.end_headers()

if __name__ == "__main__":
    port=int(os.environ.get("PORT","10000"))
    HTTPServer(("0.0.0.0",port),Handler).serve_forever()
