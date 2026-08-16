# -*- coding: utf-8 -*-
"""
محرك معالجة اللغة الطبيعية واستخراج ردود ومواعيد التحصيل باللهجة المصرية
Egyptian NLP & Collection Date Extractor Engine
"""

import re
import datetime
import calendar


def normalize_arabic(s: str) -> str:
    """تطبيع النصوص العربية وتوحيد الحروف وإزالة التشكيل"""
    if not s:
        return ""
    eastern_digits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"]
    text = str(s).strip().lower()
    # إزالة التشكيل والتطويل
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", text)
    # توحيد الألفات والتاء المربوطة والياء
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = re.sub(r"ة", "ه", text)
    text = re.sub(r"ى", "ي", text)
    text = re.sub(r"ؤ", "و", text)
    text = re.sub(r"ئ", "ي", text)
    # تنظيف الرموز والأقواس
    text = re.sub(r"[()[\]{}«»\"\'`~#*]", " ", text)
    text = re.sub(r"[ـ\-_/\\,.:;!?]", " ", text)

    # تحويل الأرقام المشرقية
    for i, digit in enumerate(eastern_digits):
        text = text.replace(digit, str(i))

    return re.sub(r"\s+", " ", text).strip()


WEEKDAYS_ARABIC = {
    "السبت": 5,
    "الاحد": 6,
    "الاتنين": 0,
    "الاثنين": 0,
    "الثلاثاء": 1,
    "التلات": 1,
    "الاربعاء": 2,
    "الاربع": 2,
    "الخميس": 3,
    "الجمعه": 4,
    "الجمعة": 4,
}

MONTHS_ARABIC = {
    "يناير": 1,
    "فبراير": 2,
    "مارس": 3,
    "ابريل": 4,
    "أبريل": 4,
    "مايو": 5,
    "يونيو": 6,
    "يوليو": 7,
    "اغسطس": 8,
    "أغسطس": 8,
    "سبتمبر": 9,
    "اكتوبر": 10,
    "أكتوبر": 10,
    "نوفمبر": 11,
    "ديسمبر": 12,
}


def parse_egyptian_date(text: str, base_date: datetime.date = None) -> tuple[datetime.date | None, str]:
    """
    تحليل العبارات الزمنية المصرية واستخراج تاريخ الاستحقاق الدقيق
    Returns: (due_date_obj, date_description)
    """
    if base_date is None:
        base_date = datetime.date.today()

    norm = normalize_arabic(text)
    if not norm:
        return None, ""

    # 1. بكرا / بكرة / غدا
    if re.search(r"\b(بكرا|بكره|غدا|بكرة)\b", norm):
        due = base_date + datetime.timedelta(days=1)
        return due, "غداً (بكرا)"

    # 2. بعد بكرا / بعد بكرة / بعد يومين
    if re.search(r"\b(بعد بكرا|بعد بكره|بعد بكرة|بعد يومين|يومين كدا|يومين كده)\b", norm):
        due = base_date + datetime.timedelta(days=2)
        return due, "بعد يومين (بعد بكرا)"

    # 3. بعد N أيام
    m_days = re.search(r"\bبعد\s+(\d+)\s*(ايام|يوم)\b", norm)
    if m_days:
        n = int(m_days.group(1))
        due = base_date + datetime.timedelta(days=n)
        return due, f"بعد {n} أيام"

    # 4. بعد اسبوع / الاسبوع الجاي / الاسبوع القادم
    if re.search(r"\b(بعد اسبوع|الاسبوع الجاي|الاسبوع القادم|الاسبوع المقبل)\b", norm):
        due = base_date + datetime.timedelta(days=7)
        return due, "الأسبوع القادم"

    # 5. بعد اسبوعين
    if re.search(r"\b(بعد اسبوعين|اسبوعين)\b", norm):
        due = base_date + datetime.timedelta(days=14)
        return due, "بعد أسبوعين"

    # 6. آخر الشهر / نهاية الشهر / مع القبض
    if re.search(r"\b(اخر الشهر|نهايه الشهر|نهاية الشهر|مع القبض|اواخر الشهر)\b", norm):
        last_day = calendar.monthrange(base_date.year, base_date.month)[1]
        due = datetime.date(base_date.year, base_date.month, last_day)
        if due <= base_date:
            # إذا كنا في آخر يوم من الشهر، ننتقل للشهر القادم
            next_month = 1 if base_date.month == 12 else base_date.month + 1
            next_year = base_date.year + 1 if base_date.month == 12 else base_date.year
            last_day_next = calendar.monthrange(next_year, next_month)[1]
            due = datetime.date(next_year, next_month, last_day_next)
        return due, "نهاية الشهر"

    # 7. أول الشهر القادم
    if re.search(r"\b(اول الشهر|بدايه الشهر|اول الشهر الجاي)\b", norm):
        next_month = 1 if base_date.month == 12 else base_date.month + 1
        next_year = base_date.year + 1 if base_date.month == 12 else base_date.year
        due = datetime.date(next_year, next_month, 1)
        return due, "أول الشهر القادم"

    # 8. أيام الأسبوع المحددة (مثال: يوم الخميس الجاي / يوم الاتنين)
    for day_name, day_idx in WEEKDAYS_ARABIC.items():
        if re.search(rf"\b(يوم\s+)?{day_name}(\s+الجاي|\s+القادم)?\b", norm):
            cur_idx = base_date.weekday()
            days_ahead = (day_idx - cur_idx) % 7
            if days_ahead == 0:
                days_ahead = 7
            due = base_date + datetime.timedelta(days=days_ahead)
            return due, f"يوم {day_name}"

    # 9. التواريخ الرقمية الصريحة: 25/8 أو 25-8 أو 25/8/2026
    m_date = re.search(r"\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b", norm)
    if m_date:
        d = int(m_date.group(1))
        m = int(m_date.group(2))
        y = int(m_date.group(3)) if m_date.group(3) else base_date.year
        if y < 100:
            y += 2000
        try:
            due = datetime.date(y, m, d)
            if due < base_date and not m_date.group(3):
                # إذا مر التاريخ في نفس السنة، يكون للسنة التالية
                due = datetime.date(y + 1, m, d)
            return due, f"تاريخ {d}/{m}/{y}"
        except ValueError:
            pass

    # 10. رقم اليوم الصريح فقط: يوم 25 / يوم 10
    m_day_num = re.search(r"\bيوم\s+(\d{1,2})\b", norm)
    if m_day_num:
        d = int(m_day_num.group(1))
        if 1 <= d <= 31:
            try:
                due = datetime.date(base_date.year, base_date.month, d)
                if due <= base_date:
                    next_month = 1 if base_date.month == 12 else base_date.month + 1
                    next_year = base_date.year + 1 if base_date.month == 12 else base_date.year
                    due = datetime.date(next_year, next_month, d)
                return due, f"يوم {d} من الشهر"
            except ValueError:
                pass

    return None, ""


def extract_payment_amount(text: str) -> float:
    """استخراج مبالغ السداد من النص إن وجدت"""
    norm = normalize_arabic(text)

    # بحث عن أنماط مثل: سدد 5000 / دفع 2500 / قبضت 1000 / خدت 3000 / مبلغ 4000
    patterns = [
        r"\b(?:سدد|دفع|قبضت|خدت|حصلت|استلمت|وصل|سداد|دفعه|دفعة|مبلغ)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\b",
        r"\b(\d+(?:[.,]\d+)?)\s*(?:ج|جم|جنيه|الف|ألف)?\s*(?:سدد|دفع|كاش|فودافون كاش|انستاباي)\b",
    ]

    for pat in patterns:
        m = re.search(pat, norm)
        if m:
            try:
                val_str = m.group(1).replace(",", "")
                val = float(val_str)
                # مضاعفة الألف إذا كان مذكوراً
                if "الف" in norm or "ألف" in norm and val < 1000:
                    val *= 1000
                return val
            except ValueError:
                continue

    return 0.0


def classify_response_status(text: str) -> tuple[str, str]:
    """
    تصنيف نوع الرد وحالة التواصل
    Returns: (action_type, comm_status)
    """
    norm = normalize_arabic(text)

    # 1. سداد
    if re.search(r"\b(سدد|دفع|قبضت|خدت منه|تم السداد|خالص|سدد خلاص)\b", norm):
        return "payment", "تم الرد / مستجيب"

    # 2. غير متاح / لا يرد
    if re.search(r"\b(مابيردش|لا يرد|مقفول|غير متاح|مغلق|مش موجود|مسافر|محدش بيرد|الرقم غير صحيح)\b", norm):
        return "unavailable", "لا يرد / غير متاح"

    # 3. نزاع / مشكلة فواتير
    if re.search(r"\b(مشكله فواتير|مشكلة فواتير|نزاع|رافض|عنده مشكله في الحساب|عنده مشكلة)\b", norm):
        return "dispute", "تم الرد / مستجيب"

    # 4. طلب مهلة
    if re.search(r"\b(طالب مهله|طلب مهلة|مهله|مهلة)\b", norm):
        return "extension", "تم الرد / مستجيب"

    # 5. وعد بموعد
    due, _ = parse_egyptian_date(text)
    if due:
        return "promise_date", "تم الرد / مستجيب"

    return "note", "تم الرد / مستجيب"


def find_matching_customer(query_text: str, master_customers: list[dict]) -> dict | None:
    """
    مطابقة اسم العميل بذكاء وفهم الألقاب والمناطق
    """
    if not query_text or not master_customers:
        return None

    norm_query = normalize_arabic(query_text)
    words = norm_query.split()

    best_match = None
    best_score = 0

    for cust in master_customers:
        name = cust.get("name") or cust.get("customer") or ""
        code = str(cust.get("code") or "")
        area = cust.get("area") or ""

        norm_name = normalize_arabic(name)
        norm_area = normalize_arabic(area)

        score = 0

        # تطابق الكود بالضبط
        if code and code in words:
            return cust

        # تطابق الاسم الكامل
        if norm_name in norm_query:
            score += 100

        # تطابق أجزاء الاسم
        name_tokens = norm_name.split()
        matched_tokens = sum(1 for t in name_tokens if t in words)
        score += matched_tokens * 20

        # تطابق المنطقة مع جزء من الاسم
        if norm_area and norm_area in words and matched_tokens > 0:
            score += 30

        if score > best_score and score >= 40:
            best_score = score
            best_match = cust

    return best_match


def parse_whatsapp_line(line: str, master_customers: list[dict] = None) -> dict | None:
    """
    تحليل سطر أو رسالة واتساب واحدة واستخراج بيانات العميل والرد والموعد والمبلغ
    أمثلة:
      - "حجاج حامد: بكرا هيسدد"
      - "محمد سيف (ابو شويقي) سدد 5000 والباقي اخر الشهر"
      - "1005: المحل مقفول"
      - "شعبان محمود - مابيردش على التليفون"
    """
    if not line or not line.strip():
        return None

    clean_line = line.strip()
    # إزالة التايم ستامب لو كانت رسالة واتساب منسوخة (مثل: [10:30, 8/16/2026] مصطفى: ...)
    clean_line = re.sub(r"^\[?\d{1,2}:\d{2}(?::\d{2})?\s*(?:ص|م|AM|PM)?,?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\]?\s*[^:]+:\s*", "", clean_line)

    # البحث عن فاصل بين اسم العميل والرد (مثل : أو - أو – أو =)
    parts = re.split(r"[:=\-–]", clean_line, maxsplit=1)
    if len(parts) >= 2:
        cust_part, resp_part = parts[0].strip(), parts[1].strip()
    else:
        # إذا لم يوجد فاصل صريح، نحاول المطابقة على كامل السطر
        cust_part = clean_line
        resp_part = clean_line

    matched_cust = find_matching_customer(cust_part, master_customers or [])
    if not matched_cust and master_customers:
        # محاولة مطابقة عبر أول 3 كلمات
        first_words = " ".join(clean_line.split()[:3])
        matched_cust = find_matching_customer(first_words, master_customers)

    customer_name = matched_cust["name"] if matched_cust else cust_part
    customer_code = matched_cust.get("code", "") if matched_cust else ""
    collector = matched_cust.get("collector", "") if matched_cust else ""
    area = matched_cust.get("area", "") if matched_cust else ""
    balance = float(matched_cust.get("balance", 0)) if matched_cust else 0.0

    action_type, comm_status = classify_response_status(resp_part)
    paid_amount = extract_payment_amount(resp_part)
    due_date_obj, date_desc = parse_egyptian_date(resp_part)

    return {
        "raw_text": line,
        "customer": customer_name,
        "code": customer_code,
        "collector": collector,
        "area": area,
        "balance": balance,
        "response_text": resp_part if resp_part != clean_line else clean_line,
        "action": action_type,
        "paid_amount": paid_amount,
        "comm_status": comm_status,
        "due_date": due_date_obj.strftime("%Y-%m-%d") if due_date_obj else "",
        "due_date_formatted": due_date_obj.strftime("%d/%m/%Y") if due_date_obj else "",
        "date_description": date_desc,
        "matched": matched_cust is not None,
    }


def parse_whatsapp_batch(batch_text: str, master_customers: list[dict] = None) -> list[dict]:
    """تحليل نص محادثة واتساب كاملة متعددة الأسطر دفعة واحدة"""
    results = []
    lines = batch_text.strip().split("\n")
    for line in lines:
        parsed = parse_whatsapp_line(line, master_customers)
        if parsed and (parsed["matched"] or len(parsed["customer"]) > 2):
            results.append(parsed)
    return results
