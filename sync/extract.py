# توزيع تحصيل: extract.py
# يقرأ شيت تحصيل.xlsm مباشرة ويصدر data.json لكل التطبيق (بدون openpyxl — مكتبة قياسية فقط)
# المعادلات معادلة لتلك الموجودة في الشيت:
#   H (موعد التحصيل) = F (آخر زيارة) + G (أيام الاتفاق)
#   I (حالة العميل)  = الرصيد<=0 => خالص / نشط
#   K (حالة اليوم)   = خالص => ✅ خالص | H<=TODAY => 🎯 هدف اليوم | وإلا 🟢 ساري
#   تقييم (خط_سير)   = معدل دوران = المسحوب/المتبقي | >60 يوم بلا فاتورة => خطر
import sys, json, re, os, zipfile, datetime, hashlib
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

SHEET_PATH = r"D:\Mostafa Ibrahim\شيت تحصيل.xlsm"
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "data.json")

# عبد الرحمن = محمد شعبان (نفس الشخص) — نعرض الاسم الموحد
COLLECTOR_ALIAS = {"عبد الرحمن": "محمد شعبان", "عبدالرحمن": "محمد شعبان"}


def collector_alias(name):
    return COLLECTOR_ALIAS.get(name, name)


def xl_date(v):
    if isinstance(v, str):
        try:
            f = float(v)
        except ValueError:
            return ""
    else:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return ""
    if f <= 0:
        return ""
    try:
        return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=f)).strftime("%Y-%m-%d")
    except (OverflowError, ValueError):
        return ""


def reform_date(v):
    "يصفح التاريخ المكتوب نصاً مثل 46246 إلى صيغة يوم-شهر"
    d = xl_date(v)
    if not d:
        return ""
    try:
        dt = datetime.datetime.strptime(d, "%Y-%m-%d")
        months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]
        return f"{dt.day} {months[dt.month-1]}"
    except ValueError:
        return d


def parse_sheet(zf, shared, idx):
    path = f"xl/worksheets/sheet{idx}.xml"
    if path not in zf.namelist():
        return []
    t = ET.fromstring(zf.read(path))
    rows = []
    for row in t.iter(M + "row"):
        rn = int(row.get("r"))
        cells = {}
        for c in row:
            ref = c.get("r")
            if not ref:
                continue
            col = re.match(r"[A-Z]+", ref).group(0)
            v = c.find(M + "v")
            if v is None or v.text is None:
                cells[col] = ""
                continue
            if c.get("t") == "s":
                cells[col] = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                cells[col] = "".join(n.text or "" for n in c.iter(M + "t"))
            else:
                cells[col] = v.text
        rows.append((rn, cells))
    return rows


def workbooks(zf):
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid_map = {r.get("Id"): r.get("Target") for r in rels}
    RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    out = {}
    for s in wb.iter(M + "sheet"):
        out[s.get("name")] = rid_map.get(s.get(RID), "")
    return out


def today_serial():
    return (datetime.datetime.now() - datetime.datetime(1899, 12, 30)).days


def compute_master_row(cells):
    bal = cells.get("C", "")
    due = xl_date(cells.get("H"))
    last_visit = xl_date(cells.get("F"))
    status = cells.get("I", "")
    k = cells.get("K", "")
    # إعادة حساب الحالة اليومية بنفس منطق الشيت
    try:
        b = float(bal)
    except (TypeError, ValueError):
        b = 0
    if status == "":
        status = "عميل خالص" if b <= 0 else "نشط"
    if k == "":
        if status == "عميل خالص":
            k = "✅ خالص"
        elif not due:
            k = ""
        else:
            k = "🎯 هدف اليوم" if cells.get("H") and float(cells.get("H")) <= today_serial() else "🟢 ساري"
    return {
        "code": cells.get("A", ""),
        "name": cells.get("B", ""),
        "balance": b,
        "last_payment": xl_date(cells.get("D")),
        "last_invoice": xl_date(cells.get("E")),
        "last_visit": last_visit,
        "agreement_days": cells.get("G", ""),
        "due_date": due,
        "status": status,
        "collector": collector_alias(cells.get("J", "")),
        "today_status": k,
        "classification": cells.get("L", ""),
        "notes": cells.get("M", ""),
        "agreements": cells.get("N", ""),
        "cycle_start": xl_date(cells.get("Q")),
        "total_withdrawn": float(cells.get("R") or 0),
        "total_paid": float(cells.get("S") or 0),
        "area": cells.get("T", ""),
    }


def main():
    zf = zipfile.ZipFile(SHEET_PATH)
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        t = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        shared = ["".join(n.text or "" for n in si.iter(M + "t")) for si in t]
    sheets = workbooks(zf)
    name2num = {name: int(re.search(r"sheet(\d+)", t).group(1)) for name, t in sheets.items() if re.search(r"sheet(\d+)", t)}
    parse = lambda name: parse_sheet(zf, shared, name2num.get(name, 0)) if name in name2num else []

    master_raw = parse("Master_Data")
    master = [compute_master_row(c) for rn, c in master_raw if rn > 1 and c.get("B")]
    pay = [{"customer": c.get("A"), "date": xl_date(c.get("B")), "date_ar": reform_date(c.get("B")), "amount": float(c.get("C") or 0)}
           for rn, c in parse("قبض") if rn > 1 and c.get("A")]
    inv = [{"num": c.get("A"), "date": xl_date(c.get("B")), "customer": c.get("C"), "amount": float(c.get("D") or 0)}
           for rn, c in parse("فواتير") if rn > 1 and c.get("A")]

    route_line = []
    for rn, c in parse("خط_سير"):
        if rn == 1 or not c.get("E"):
            continue
        route_line.append({
            "prev_due": xl_date(c.get("A")), "appt_status": c.get("B", ""), "new_due": xl_date(c.get("C")),
            "customer": c.get("E"), "target_debt": float(c.get("F") or 0), "area": c.get("G", ""),
            "last_payment": xl_date(c.get("H")), "last_invoice": xl_date(c.get("I")),
            "last_response": c.get("J", ""), "total_withdrawn": float(c.get("K") or 0),
            "total_paid": float(c.get("L") or 0), "collected": float(c.get("M") or 0),
            "remaining": float(c.get("N") or 0), "collection_rate": c.get("O", ""),
            "turnover": c.get("P", ""), "rating": c.get("Q", ""),
        })

    cf_rows = []
    for rn, c in parse("cash flow"):
        if rn <= 4 or not c.get("C"):
            continue
        cf_rows.append({
            "customer": c.get("C"), "balance": float(c.get("B") or 0),
            "expected": float(c.get("D") or 0), "collected": float(c.get("E") or 0),
            "due": xl_date(c.get("F")), "pay_ratio": c.get("G", ""),
            "pay_status": c.get("H", ""), "remaining": float(c.get("I") or 0), "notes": c.get("J", ""),
        })

    follow_up = []
    for rn, c in parse("متابعة مندوب"):
        if rn == 1 or not c.get("B"):
            continue
        follow_up.append({k: v for k, v in c.items() if v != ""})

    collector_follow = []
    for rn, c in parse("متابعة المحصل "):
        if rn <= 2 or not c.get("B"):
            continue
        collector_follow.append({
            "customer": c.get("B"), "target_debt": float(c.get("C") or 0), "area": c.get("D", ""),
            "last_payment": xl_date(c.get("E")), "last_invoice": xl_date(c.get("F")),
            "last_response": c.get("G", ""),
        })

    # خط سير اليوم لكل محصل (من Master_Data بنفس منطق الشيت: <= TODAY وليس خالص)
    # تجاهل أي عميل رصيده أقل من 110 ج
    today = today_serial()
    daily = []
    for m in master:
        h = None
        for rn, c in master_raw:
            if c.get("B") == m["name"] and c.get("H"):
                h = c.get("H")
                break
        if h and float(h) <= today and m["status"] != "عميل خالص":
            try:
                bal = float(m["balance"])
            except (TypeError, ValueError):
                bal = 0
            if bal < 110:
                continue
            daily.append({
                "customer": m["name"], "balance": bal, "collector": m["collector"],
                "area": m["area"], "due": m["due_date"], "classification": m["classification"],
                "notes": m["notes"], "last_payment": m["last_payment"],
                "last_visit": m["last_visit"],
            })
    daily.sort(key=lambda x: x["balance"], reverse=True)

    # عملاء بالدورة: نفس منطق الشيت — عدد الأيام المتبقية = نهاية الدورة (F) - اليوم
    # القيم السالبة = انتهت الدورة ويستحق التحصيل
    cycle_clients = []
    for rn, c in parse("عملاء الدورة "):
        if rn <= 2 or not c.get("B"):
            continue
        cycle_clients.append({
            "seq": c.get("A", ""),
            "customer": c.get("B").strip(),
            "balance": float(c.get("C") or 0),
            "due_date": xl_date(c.get("D")),
            "cycle_start": xl_date(c.get("E")),
            "cycle_end": xl_date(c.get("F")),
            "days_left": (float(c.get("F") or 0) - today_serial()) if c.get("F") else None,
        })

    # شيتا Daily_Route (محمد شعبان) و Daily_Route_Mostafa (مصطفى)
    # كل شيت فيه كتلتان: "عملاء اليوم" (أعمدة B/C) و "المتأخرات" (أعمدة H/I)
    # الرواتب/التواريخ/الأعمدة كما هي في الشيت (نفس منطق الشيت بالضبط)
    def parse_daily_route(sheetname):
        today_block, overdue_block = [], []
        for rn, c in parse(sheetname):
            if rn <= 2:
                continue
            if c.get("B"):
                today_block.append({
                    "customer": c.get("B").strip(),
                    "balance": float(c.get("C") or 0),
                    "last_invoice": xl_date(c.get("D")),
                    "last_payment": xl_date(c.get("E")),
                })
            if c.get("H"):
                overdue_block.append({
                    "customer": c.get("H").strip(),
                    "balance": float(c.get("I") or 0),
                    "last_invoice": xl_date(c.get("J")),
                    "last_payment": xl_date(c.get("K")),
                })
        return {"today": today_block, "overdue": overdue_block}

    daily_route = parse_daily_route("Daily_Route")            # محمد شعبان
    daily_route_mostafa = parse_daily_route("Daily_Route_Mostafa")  # مصطفى

    data = {
        "meta": {
            "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": os.path.basename(SHEET_PATH),
            "version": "1.0",
        },
        "master": master,
        "payments": pay,
        "invoices": inv,
        "route_line": route_line,
        "cash_flow": cf_rows,
        "follow_up": follow_up,
        "collector_follow": collector_follow,
        "daily_targets": daily,
        "route_sheets": {
            "محمد شعبان": daily_route,
            "مصطفى": daily_route_mostafa,
        },
        "cycle_clients": cycle_clients,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"OK master={len(master)} payments={len(pay)} invoices={len(inv)} route={len(route_line)} cf={len(cf_rows)} daily={len(daily)}")
    print(f"-> {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")


if __name__ == "__main__":
    main()