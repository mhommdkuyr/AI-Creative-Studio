import os
from http.server import BaseHTTPRequestHandler, HTTPServer

VIDEO_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_30Qx9tWAprEzrz9cJKO51812Ejq/c0d8622b-0154-42d8-b853-0b8001e159ba.mp4"
THUMB_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_30Qx9tWAprEzrz9cJKO51812Ejq/523f2956-a1c7-4054-b893-26de48f4cc8c.jpg"
SCRIPT_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_30Qx9tWAprEzrz9cJKO51812Ejq/d767559f-e662-4501-a816-1fd1ed9fcb03.txt"

HTML = f'''<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="يوميات لمى — الحلقة الافتتاحية: آخر فيديو وبنام!">
<meta name="theme-color" content="#14213d">
<title>يوميات لمى | الحلقة ١ — آخر فيديو وبنام!</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:linear-gradient(150deg,#14213d,#243b64 60%,#7cc9e8);font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;color:#172033}}
main{{width:min(94vw,560px);padding:18px}}
.card{{background:#fff;border-radius:24px;padding:18px;box-shadow:0 12px 50px rgba(0,0,0,.25);text-align:center}}
.kicker{{display:inline-block;background:#ffe36b;padding:6px 12px;border-radius:999px;font-weight:800}}
h1{{font-size:clamp(24px,5vw,32px);margin:12px 0 8px}}
p{{color:#525a6b;line-height:1.8}}
video{{display:block;width:100%;max-height:70vh;aspect-ratio:9/16;object-fit:contain;border-radius:18px;background:#080b12;margin:16px auto}}
a{{display:inline-block;margin:8px 5px;padding:12px 17px;border-radius:12px;background:#17233e;color:#fff;text-decoration:none;font-weight:700}}
a.secondary{{background:#ecf2fa;color:#17233e}}
small{{display:block;color:#677086;margin-top:14px;line-height:1.6}}
</style></head>
<body><main><section class="card">
<div class="kicker">الحلقة ١ • أنيميشن كوميدي</div>
<h1>آخر فيديو وبنام! 😂</h1>
<p><b>يوميات لمى</b> — لمى قالت «فيديو واحد بس»… وبعدها حصل اللي ما كانش في الحسبان!</p>
<video controls playsinline preload="metadata" poster="{THUMB_URL}">
<source src="{VIDEO_URL}" type="video/mp4">
متصفحك لا يدعم تشغيل الفيديو.
</video>
<a href="{VIDEO_URL}" target="_blank" rel="noopener">فتح / تحميل ملف MP4</a>
<a class="secondary" href="{THUMB_URL}" target="_blank" rel="noopener">الصورة المصغرة</a>
<a class="secondary" href="{SCRIPT_URL}" target="_blank" rel="noopener">السيناريو وبيانات النشر</a>
<small>نسخة افتتاحية تجريبية مدتها 30 ثانية. الرسوم أصلية، والمونتاج يعتمد على حركة كاميرا 2.5D وانتقالات وصوت عربي. لا توجد ضمانة للانتشار؛ سنحسن النسخة التالية بناءً على الاحتفاظ بالمشاهدين.</small>
</section></main></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            data = HTML.encode("utf-8")
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
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    port=int(os.environ.get("PORT","10000"))
    HTTPServer(("0.0.0.0",port),Handler).serve_forever()
