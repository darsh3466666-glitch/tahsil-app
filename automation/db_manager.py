# -*- coding: utf-8 -*-
"""
إدارة قاعدة البيانات المحلية لتخزين التنبيهات المجدولة وسجلات الواتساب والسداد
Local SQLite Database Manager for Scheduled Alarms, Logs & Payments
"""

import sqlite3
import datetime
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tahsil_automation.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """إنشاء جداول قاعدة البيانات إذا لم تكن موجودة"""
    with get_connection() as conn:
        cursor = conn.cursor()

        # جدول التنبيهات ومواعيد المتابعة المجدولة
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                customer_code TEXT,
                collector TEXT,
                area TEXT,
                balance REAL DEFAULT 0.0,
                due_date TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                is_notified INTEGER DEFAULT 0,
                notified_at TEXT
            )
        """)

        # جدول السدادات المسجلة
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                amount REAL NOT NULL,
                collector TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                synced_to_excel INTEGER DEFAULT 0,
                synced_to_telegram INTEGER DEFAULT 0
            )
        """)

        # جدول سجلات رسائل الواتساب
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT,
                raw_message TEXT NOT NULL,
                parsed_json TEXT,
                status TEXT DEFAULT 'processed',
                created_at TEXT NOT NULL
            )
        """)

        conn.commit()


def add_reminder(customer_name, due_date, collector="", area="", balance=0.0, notes="", code=""):
    """إضافة أو تحديث موعد استحقاق وتنبيه للعميل"""
    now = datetime.datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        # حذف أي تنبيه سابق غير منفذ لنفس العميل لتفادي التكرار
        cursor.execute("DELETE FROM reminders WHERE customer_name = ? AND is_notified = 0", (customer_name,))
        cursor.execute("""
            INSERT INTO reminders (customer_name, customer_code, collector, area, balance, due_date, notes, created_at, is_notified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (customer_name, code, collector, area, balance, due_date, notes, now))
        conn.commit()


def get_due_reminders_for_date(target_date_str: str = None):
    """جلب قائمة التنبيهات المستحقة في تاريخ محدد (الافتراضي: اليوم)"""
    if not target_date_str:
        target_date_str = datetime.date.today().strftime("%Y-%m-%d")

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM reminders 
            WHERE due_date <= ? AND is_notified = 0
            ORDER BY collector, area, customer_name
        """, (target_date_str,))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]


def mark_reminders_as_notified(reminder_ids: list[int]):
    """تعليم التنبيهات على أنها تم إرسالها"""
    if not reminder_ids:
        return
    now = datetime.datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        placeholders = ",".join("?" * len(reminder_ids))
        cursor.execute(f"""
            UPDATE reminders 
            SET is_notified = 1, notified_at = ? 
            WHERE id IN ({placeholders})
        """, [now] + reminder_ids)
        conn.commit()


def log_payment(customer_name, amount, collector="", notes=""):
    """تسجيل حركة سداد جديدة"""
    now = datetime.datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO payments (customer_name, amount, collector, notes, created_at, synced_to_excel, synced_to_telegram)
            VALUES (?, ?, ?, ?, ?, 0, 0)
        """, (customer_name, amount, collector, notes, now))
        conn.commit()


def log_whatsapp_message(raw_msg, parsed_dict=None, sender=""):
    """تسجيل رسالة واردة من الواتساب في الأرشيف"""
    now = datetime.datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO whatsapp_logs (sender, raw_message, parsed_json, created_at)
            VALUES (?, ?, ?, ?)
        """, (sender, raw_msg, json.dumps(parsed_dict, ensure_ascii=False) if parsed_dict else "", now))
        conn.commit()


# تهيئة الجداول عند الاستدعاء الأول
init_db()
