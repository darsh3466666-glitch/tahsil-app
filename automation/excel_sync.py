# -*- coding: utf-8 -*-
"""
محرك إدارة الردود والسدادات والتنبيهات المجدولة وتطبيق الويب
ملاحظة أمان: ملف الإكسل الأصلي (شيت تحصيل.xlsm) محمي وهو للقراءة فقط (Read-Only) تماماً وممنوع تعديله نهائياً.
يتم حفظ كل التحديثات والردود والمواعيد بأمان في قاعدة البيانات والتطبيق.
"""

import os
import json
import datetime
import subprocess

try:
    from . import db_manager
    from . import telegram_notifier
except ImportError:
    import db_manager
    import telegram_notifier

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON_PATH = os.path.join(BASE_DIR, "data", "data.json")
EXTRACT_SCRIPT_PATH = os.path.join(BASE_DIR, "sync", "extract.py")


def load_app_data() -> dict:
    """قراءة ملف data.json الحالي"""
    if os.path.exists(DATA_JSON_PATH):
        try:
            with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Data Load Error] {e}")
    return {}


def save_app_data(data: dict) -> bool:
    """حفظ التحديثات في ملف data.json ليتحدث التطبيق فورياً"""
    try:
        with open(DATA_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[Data Save Error] {e}")
        return False


def apply_parsed_record(parsed: dict, notify_telegram: bool = True) -> dict:
    """
    تطبيق السجل المستخرج من الواتساب وتحديث كل المسارات تلقائياً:
    1. قاعدة بيانات التنبيهات المجدولة (SQLite)
    2. قاعدة بيانات التطبيق (data.json)
    3. إرسال إشعار فوري على تليجرام في حالة السداد
    """
    cust_name = parsed.get("customer")
    if not cust_name:
        return {"success": False, "error": "اسم العميل غير محدد"}

    collector = parsed.get("collector") or ""
    area = parsed.get("area") or ""
    balance = float(parsed.get("balance") or 0.0)
    response_text = parsed.get("response_text") or ""
    paid_amount = float(parsed.get("paid_amount") or 0.0)
    comm_status = parsed.get("comm_status") or "تم الرد / مستجيب"
    due_date = parsed.get("due_date") or ""
    code = parsed.get("code") or ""

    # 1. إذا وجد موعد استحقاق قادم، نحفظه في جدول التنبيهات المجدولة لتقرير الصباح
    if due_date:
        db_manager.add_reminder(
            customer_name=cust_name,
            due_date=due_date,
            collector=collector,
            area=area,
            balance=balance,
            notes=response_text,
            code=code
        )

    # 2. إذا كان هناك سداد نقدي مسجل
    if paid_amount > 0:
        db_manager.log_payment(
            customer_name=cust_name,
            amount=paid_amount,
            collector=collector,
            notes=response_text
        )
        if notify_telegram:
            telegram_notifier.send_instant_payment_alert(
                customer_name=cust_name,
                amount=paid_amount,
                collector=collector,
                notes=response_text
            )

    # 3. تحديث ملف data.json
    app_data = load_app_data()
    updated_master = False
    updated_route = False

    # تحديث في Master Data
    for m in app_data.get("master", []):
        if m.get("name") == cust_name or (code and str(m.get("code")) == str(code)):
            m["notes"] = response_text
            if due_date:
                m["due_date"] = due_date
            if not collector and m.get("collector"):
                collector = m.get("collector")
            updated_master = True
            break

    # تحديث في route_line
    for r in app_data.get("route_line", []):
        if r.get("customer") == cust_name:
            r["last_response"] = response_text
            if due_date:
                r["due_date"] = due_date
            updated_route = True
            break

    save_app_data(app_data)

    return {
        "success": True,
        "customer": cust_name,
        "collector": collector,
        "due_date": due_date,
        "paid_amount": paid_amount,
        "synced_master": updated_master,
        "synced_route": updated_route
    }


def sync_batch_records(records: list[dict], notify_telegram: bool = True) -> dict:
    """مزامنة دفعة سجلات كاملة دفعة واحدة"""
    results = []
    success_count = 0
    total_paid = 0.0
    scheduled_count = 0

    for rec in records:
        res = apply_parsed_record(rec, notify_telegram=notify_telegram)
        results.append(res)
        if res.get("success"):
            success_count += 1
            if rec.get("paid_amount", 0) > 0:
                total_paid += rec["paid_amount"]
            if rec.get("due_date"):
                scheduled_count += 1

    return {
        "total_processed": len(records),
        "success_count": success_count,
        "total_paid_collected": total_paid,
        "scheduled_reminders_count": scheduled_count,
        "details": results
    }
