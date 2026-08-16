# -*- coding: utf-8 -*-
"""
محرك إرسال التنبيهات والتقارير اليومية إلى بوت وتليجرام العمل
Zero-Dependency Telegram Bot API Client & Scheduled 10:00 AM Reporter
"""

import sys
if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
if hasattr(sys.stderr, "reconfigure"):
    try: sys.stderr.reconfigure(encoding="utf-8")
    except Exception: pass

import urllib.request
import urllib.parse
import json
import datetime
import os

# استيراد مدير قاعدة البيانات
try:
    from . import db_manager
except ImportError:
    import db_manager

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config() -> dict:
    """تحميل ملف الإعدادات"""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "telegram": {
            "bot_token": "",
            "work_chat_id": "",
            "morning_report_time": "10:00",
            "enable_instant_payment_alerts": True,
        }
    }


def save_config(cfg: dict) -> bool:
    """حفظ الإعدادات"""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def auto_detect_chat_id() -> str | None:
    """اكتشاف معرف الشات أو الجروب تلقائياً عند بدء المحادثة أو إرسال أي رسالة للبوت"""
    cfg = load_config()
    token = cfg.get("telegram", {}).get("bot_token")
    if not token:
        return None

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TahsilBot/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("result", [])
            if results:
                last_msg = results[-1]
                chat = last_msg.get("message", {}).get("chat") or last_msg.get("channel_post", {}).get("chat")
                if chat and "id" in chat:
                    chat_id = str(chat["id"])
                    chat_title = chat.get("title") or chat.get("first_name") or "شات العمل"
                    if cfg.get("telegram", {}).get("work_chat_id") != chat_id:
                        cfg["telegram"]["work_chat_id"] = chat_id
                        save_config(cfg)
                        print(f"✅ [Telegram] تم ربط الشات تلقائياً: {chat_title} (Chat ID: {chat_id})")
                        welcome_text = (
                            f"🎉 *تم ربط بوت 'النور للاعلاف' بنظام التحصيل بنجاح! ✓*\n"
                            f"━━━━━━━━━━━━━━━━━━━━━\n"
                            f"⏰ سيصلك هنا يومياً *تقرير المتابعات والتحصيلات الصباحي الساعة 10:00 صباحاً*.\n"
                            f"💸 سيتم إشعارك فورياً بأي عملية تحصيل أو سداد جديدة.\n\n"
                            f"🎯 يمكنك كتابة `/today` أو `/report` في أي وقت لعرض تقرير اليوم فوراً."
                        )
                        send_telegram_message(welcome_text, chat_id=chat_id, bot_token=token)
                    return chat_id
    except Exception:
        pass
    return None


def format_money(val) -> str:
    """تنسيق المبالغ المالية بالأرقام والفواصل"""
    try:
        f = float(val)
        return f"{int(round(f)):,} ج.م"
    except (ValueError, TypeError):
        return "0 ج.م"


def send_telegram_message(text: str, chat_id: str = None, bot_token: str = None, parse_mode: str = "Markdown") -> bool:
    """
    إرسال رسالة إلى تليجرام باستخدام مكتبة بايثون القياسية urllib بدون أي مكتبات خارجية
    """
    cfg = load_config()
    token = bot_token or cfg.get("telegram", {}).get("bot_token")
    target_chat = chat_id or cfg.get("telegram", {}).get("work_chat_id")

    if not token or token == "YOUR_TELEGRAM_BOT_TOKEN":
        print("[Telegram Notice] لم يتم ضبط توكن بوت تليجرام بعد في config.json")
        return False
    if not target_chat or target_chat == "YOUR_WORK_CHAT_OR_GROUP_ID":
        print("[Telegram Notice] لم يتم ضبط معرف الشات / الجروب في config.json")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": target_chat,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            return res_data.get("ok", False)
    except Exception as e:
        print(f"[Telegram Error] فشل الإرسال إلى تليجرام: {e}")
        return False


def build_morning_report_text(reminders: list[dict], report_date: datetime.date = None) -> str:
    """بناء قائمة نقطية سريعة ومدمجة لمتابعات اليوم (سطر واحد لكل عميل)"""
    if report_date is None:
        report_date = datetime.date.today()

    date_str = report_date.strftime("%d/%m")

    if not reminders:
        return f"⏰ *متابعات اليوم ({date_str}):* لا توجد مواعيد مستحقة اليوم ✅"

    # تقسيم العملاء حسب المحصل
    grouped = {}
    total_balance = 0.0
    for r in reminders:
        rep = r.get("collector") or "عام"
        if rep not in grouped:
            grouped[rep] = []
        grouped[rep].append(r)
        total_balance += float(r.get("balance") or 0.0)

    lines = [f"⏰ *متابعات اليوم ({date_str}):*\n"]

    for rep, items in grouped.items():
        lines.append(f"👤 *{rep}:*")
        for item in items:
            cust_name = item.get("customer_name") or "عميل"
            area = item.get("area")
            area_str = f" ({area})" if area and area != "—" and area != "__" else ""
            bal = format_money(item.get("balance") or 0)
            notes = item.get("notes") or "متابعة"
            lines.append(f"• *{cust_name}*{area_str} | {bal} | {notes}")
        lines.append("")

    lines.append(f"📊 *الإجمالي:* {format_money(total_balance)} ({len(reminders)} عميل)")
    return "\n".join(lines).strip()


def send_morning_collection_report(target_date_str: str = None) -> bool:
    """
    توليد وإرسال تقرير الصباح في موعده اليومي (10:00 ص)
    """
    if not target_date_str:
        target_date_str = datetime.date.today().strftime("%Y-%m-%d")

    reminders = db_manager.get_due_reminders_for_date(target_date_str)
    report_text = build_morning_report_text(reminders)

    success = send_telegram_message(report_text)
    if success and reminders:
        # تعليم التنبيهات المرسلة
        reminder_ids = [r["id"] for r in reminders if "id" in r]
        db_manager.mark_reminders_as_notified(reminder_ids)
        print(f"[Telegram Success] تم إرسال تقرير الصباح لعدد {len(reminders)} عميل.")
    elif success:
        print("[Telegram Success] تم إرسال تقرير الصباح.")
    return success


def send_instant_payment_alert(customer_name: str, amount: float, collector: str = "", notes: str = "") -> bool:
    """
    إشعار فوري مختصر وسريع عند تسجيل أي سداد
    """
    cfg = load_config()
    if not cfg.get("telegram", {}).get("enable_instant_payment_alerts", True):
        return False

    rep_str = f" ({collector})" if collector else ""
    notes_str = f" | {notes}" if notes else ""
    text = f"💸 *سداد جديد:* *{customer_name}*{rep_str} | {format_money(amount)}{notes_str} ✓"
    return send_telegram_message(text)


if __name__ == "__main__":
    print("=== تجربة إرسال تقرير تليجرام التجريبي ===")
    test_reminders = [
        {"id": 1, "customer_name": "حجاج حامد (قصر شانة)", "collector": "محمد شعبان", "area": "قصر شانة", "balance": 28000, "notes": "وعد بالسداد اليوم"},
        {"id": 2, "customer_name": "أحمد زيور (صالح مسعود)", "collector": "مصطفى", "area": "صالح مسعود", "balance": 45000, "notes": "دفع قسط متفق عليه"},
    ]
    print(build_morning_report_text(test_reminders))
