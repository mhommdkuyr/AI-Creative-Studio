import os
from http.server import BaseHTTPRequestHandler, HTTPServer

VIDEO_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_30Qx9tWAprEzrz9cJKO51812Ejq/2d138950-4cd2-4379-9956-72d2367dd3aa.mp4"

HTML = f'''<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>عالمنا | بدر وناجي — الحلقة 1</title>
<style>
body{{margin:0;background:linear-gradient(#8ee7ff,#eaf9ff);font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}}
main{{width:min(94vw,560px);text-align:center;padding:18px}}
.card{{background:#fff;border-radius:24px;padding:18px;box-shadow:0 12px 50px rgba(0,0,0,.16)}}
video{{width:100%;max-height:78vh;border-radius:18px;background:#000}}
a{{display:inline-block;margin-top:16px;padding:13px 20px;border-radius:14px;background:#111;color:#fff;text-decoration:none}}
h1{{font-size:25px;margin:8px 0}}p{{color:#555;line-height:1.7}}
.badge{{display:inline-block;background:#ffe36b;padding:6px 12px;border-radius:999px;font-weight:700}}
</style></head>
<body><main><div class="card">
<div class="badge">الحلقة 1</div>
<h1>🧢 لا تضغط الزر! 🐱🐰</h1>
<p>أول حلقة من <b>عالمنا | بدر وناجي</b> — كوميديا أنيميشن أصلية بشخصياتنا الخاصة.</p>
<video controls playsinline preload="metadata" src="{VIDEO_URL}"></video>
<br><a href="{VIDEO_URL}" target="_blank" rel="noopener">فتح / حفظ الفيديو MP4</a>
</div></main></body></html>'''

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
            data = b"ok"
            self.send_response(200)
            self.send_header("Content-Type","text/plain")
            self.send_header("Content-Length",str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    port=int(os.environ.get("PORT","10000"))
    HTTPServer(("0.0.0.0",port),Handler).serve_forever()
