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
    """بناء وتنسيق نص التقرير الصباحي الشامل"""
    if report_date is None:
        report_date = datetime.date.today()

    # أسماء الأيام بالعربية
    days_ar = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
    day_name = days_ar[report_date.weekday()]
    date_str = report_date.strftime("%d/%m/%Y")

    if not reminders:
        return (
            f"☀️ *تقرير المتابعات والتحصيلات الصباحي*\n"
            f"📅 التاريخ: {day_name} {date_str} (الساعة 10:00 ص)\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"✅ *ممتاز!* لا توجد مواعيد سداد متأخرة أو متابعات مستحقة اليوم.\n"
            f"🎯 خط سير اليوم جاهز في التطبيق."
        )

    # تقسيم العملاء حسب المحصل
    grouped = {}
    total_balance = 0.0
    for r in reminders:
        rep = r.get("collector") or "بدون محصل محدد"
        if rep not in grouped:
            grouped[rep] = []
        grouped[rep].append(r)
        total_balance += float(r.get("balance") or 0.0)

    lines = [
        f"📋 *تقرير المتابعات والتحصيلات الصباحي*",
        f"📅 اليوم: *{day_name}* {date_str} | ⏰ *10:00 صباحاً*",
        f"━━━━━━━━━━━━━━━━━━━━━\n",
    ]

    for rep, items in grouped.items():
        rep_total = sum(float(x.get("balance") or 0) for x in items)
        lines.append(f"👤 *المحصل: {rep}* ({len(items)} عميل | {format_money(rep_total)})")
        lines.append("─────────────────────")

        for idx, item in enumerate(items, 1):
            cust_name = item.get("customer_name") or "عميل"
            area = item.get("area") or "—"
            bal = format_money(item.get("balance") or 0)
            notes = item.get("notes") or "وعد بالمتابعة اليوم"

            lines.append(f"{idx}. *{cust_name}*")
            lines.append(f"   📍 المنطقة: {area} | 💰 المديونية: {bal}")
            lines.append(f"   📝 الاتفاق السابق: _{notes}_")
            lines.append("")

        lines.append("")

    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"📊 *الإجمالي العام المستحق اليوم:* {format_money(total_balance)} ({len(reminders)} عميل)")
    lines.append("🎯 *بالتوفيق لرجال التحصيل اليوم! برجاء إرسال الردود أولاً بأول.*")

    return "\n".join(lines)


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
        print(f"[Telegram Success] تم إرسال تقرير الصباح بنجاح لعدد {len(reminders)} عميل.")
    elif success:
        print("[Telegram Success] تم إرسال تقرير الصباح (لا توجد متابعات لليوم).")
    return success


def send_instant_payment_alert(customer_name: str, amount: float, collector: str = "", notes: str = "") -> bool:
    """
    إرسال إشعار فوري لحظة تحصيل أي دفعة
    """
    cfg = load_config()
    if not cfg.get("telegram", {}).get("enable_instant_payment_alerts", True):
        return False

    now_time = datetime.datetime.now().strftime("%I:%M %p")
    text = (
        f"💸 *تم تسجيل سداد تحصيل جديد ✓*\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 *العميل:* {customer_name}\n"
        f"💰 *المبلغ المحصل:* {format_money(amount)}\n"
        f"📍 *المحصل:* {collector or 'عام'}\n"
        f"⏰ *الوقت:* {now_time}\n"
        f"{f'📝 *بيان:* {notes}' if notes else ''}"
    )
    return send_telegram_message(text)


if __name__ == "__main__":
    print("=== تجربة إرسال تقرير تليجرام التجريبي ===")
    test_reminders = [
        {"id": 1, "customer_name": "حجاج حامد (قصر شانة)", "collector": "محمد شعبان", "area": "قصر شانة", "balance": 28000, "notes": "وعد بالسداد اليوم"},
        {"id": 2, "customer_name": "أحمد زيور (صالح مسعود)", "collector": "مصطفى", "area": "صالح مسعود", "balance": 45000, "notes": "دفع قسط متفق عليه"},
    ]
    print(build_morning_report_text(test_reminders))
