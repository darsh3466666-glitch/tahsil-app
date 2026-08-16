# -*- coding: utf-8 -*-
"""
الخدمة الخلفية الرئيسية الشاملة لأتمتة التحصيل (WhatsApp Daemon, Scheduler & Local API Server)
Master Tahsil Automation Service & Daily 10:00 AM Scheduler
"""

import sys
import os
import json
import time
import datetime
import threading
import http.server
import socketserver
import urllib.parse

# إضافة المسار الحالي
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import nlp_engine
import db_manager
import telegram_notifier
import data_sync

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
PORT = 8765
last_report_sent_date = None


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "telegram": {
            "morning_report_time": "10:00"
        }
    }


def scheduler_loop():
    """حلقة المجدول اليومي لفحص الساعة 10:00 صباحاً وإرسال تقرير الصباح"""
    global last_report_sent_date
    print(f"⏰ [Scheduler] بدأ المجدول الآلي — موعد التقرير الصباحي اليومي: 10:00 صباحاً")

    while True:
        try:
            now = datetime.datetime.now()
            today_str = now.strftime("%Y-%m-%d")
            cfg = load_config()
            target_time = cfg.get("telegram", {}).get("morning_report_time", "10:00")
            current_time_str = now.strftime("%H:%M")

            # التحقق إذا وصلنا لموعد التقرير الصباحي (10:00) ولم يتم إرساله اليوم بعد
            if current_time_str == target_time and last_report_sent_date != today_str:
                print(f"📢 [Scheduler] حلول موعد التقرير الصباحي ({target_time})! جارِ الإرسال على تليجرام...")
                success = telegram_notifier.send_morning_collection_report(today_str)
                if success:
                    last_report_sent_date = today_str
                    print(f"✅ [Scheduler] تم إرسال تقرير صباح {today_str} بنجاح.")

            time.sleep(30)
        except Exception as e:
            print(f"[Scheduler Error] {e}")
            time.sleep(30)


class AutomationHttpHandler(http.server.BaseHTTPRequestHandler):
    """خادم محلي خفيف للربط المباشر مع تطبيق الويب والواتساب"""

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == "/api/status":
            cfg = load_config()
            today_str = datetime.date.today().strftime("%Y-%m-%d")
            due_reminders = db_manager.get_due_reminders_for_date(today_str)
            resp = {
                "service": "tahsil-automation-daemon",
                "status": "running",
                "current_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "morning_report_time": cfg.get("telegram", {}).get("morning_report_time", "10:00"),
                "last_report_sent_date": last_report_sent_date,
                "due_reminders_today_count": len(due_reminders),
                "due_reminders_today": due_reminders,
            }
            self._set_headers(200)
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode("utf-8"))

        elif path == "/api/trigger-report":
            # إرسال تجريبي للتقرير الصباحي فوراً
            success = telegram_notifier.send_morning_collection_report()
            self._set_headers(200 if success else 500)
            self.wfile.write(json.dumps({"success": success}, ensure_ascii=False).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode("utf-8")

        try:
            req_data = json.loads(post_body) if post_body else {}
        except Exception:
            req_data = {}

        if path == "/api/parse-whatsapp":
            # تحليل نصوص الواتساب وإرجاع النتائج المستخرجة
            raw_text = req_data.get("text", "")
            app_data = data_sync.load_app_data()
            master = app_data.get("master", [])
            parsed_list = nlp_engine.parse_whatsapp_batch(raw_text, master)
            self._set_headers(200)
            self.wfile.write(json.dumps({"count": len(parsed_list), "records": parsed_list}, ensure_ascii=False).encode("utf-8"))

        elif path == "/api/sync-whatsapp":
            # تطبيق ومزامنة السجلات في قاعدة بيانات التطبيق وتليجرام
            records = req_data.get("records", [])
            if not records and "text" in req_data:
                app_data = data_sync.load_app_data()
                records = nlp_engine.parse_whatsapp_batch(req_data["text"], app_data.get("master", []))

            result = data_sync.sync_batch_records(records, notify_telegram=req_data.get("notify_telegram", True))
            self._set_headers(200)
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def log_message(self, format, *args):
        # تجاوز الطباعة العشوائية للـ HTTP access logs
        pass


def run_server():
    """تشغيل الخادم المحلي"""
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), AutomationHttpHandler) as httpd:
            print(f"🌐 [Local API] الخادم المحلي يعمل على http://127.0.0.1:{PORT}")
            httpd.serve_forever()
    except Exception as e:
        print(f"[Server Error] {e}")


def main():
    print("=" * 60)
    print("🚀 بدء تشغيل منظومة أتمتة التحصيل (تليجرام + واتساب + إكسيل)")
    print("=" * 60)

    # 1. تشغيل المجدول في خيط منفصل
    scheduler_thread = threading.Thread(target=scheduler_loop, daemon=True)
    scheduler_thread.start()

    # 2. تشغيل السيرفر المحلي
    run_server()


if __name__ == "__main__":
    main()
