# watch.py — مراقبة شيت تحصيل.xlsm وتحديث GitHub تلقائياً
# يعمل في الخلفية: كل 30 ثانية يفحص إذا تغيّر الشيت؛ عند أي تغيير يعيد تصدير data.json
# ويدفع التحديث لـ GitHub (git add + commit + push) فيتحدث الموقع لايف.
import os, sys, time, hashlib, subprocess

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")

SHEET_PATH = r"D:\Mostafa Ibrahim\شيت تحصيل.xlsm"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
PYTHON = r"G:\Python312\python.exe"
POLL_SECONDS = 30


def file_fingerprint(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"CMD FAIL {' '.join(cmd)}: {r.stderr[:500]}")
    return r


def main():
    print("Watcher بدأ (فترة الفحص: %ss)" % POLL_SECONDS)
    last = None
    while True:
        try:
            fp = file_fingerprint(SHEET_PATH)
            if fp is None:
                print("! الشيت غير متاح (مقفول أو محذوف؟) — الانتظار...")
            elif fp != last:
                if last is not None:
                    time.sleep(5)  # مهلة أغفال حفاض Excel
                    print(f"[{time.strftime('%H:%M:%S')}] تغيّر الشيت — تصدير...")
                    r = run([PYTHON, os.path.join(SCRIPT_DIR, "extract.py")], REPO_DIR)
                    ok = r.returncode == 0
                    if not ok:
                        print("  تصدير فشل — سيحاول مجدداً في الدورة القادمة")
                        last = None  # أعد الفحص بنفس الحالة عند الفشل
                        continue
                    # دفع لـ GitHub
                    push = run(["git", "add", "-A"], REPO_DIR)
                    out = run(["git", "commit", "-m", f"تحديث تلقائي: {time.strftime('%Y-%m-%d %H:%M')}", "--no-gpg-sign"], REPO_DIR)
                    if out.returncode == 0 and "nothing to commit" not in out.stdout.lower():
                        run(["git", "push", "origin", "main"], REPO_DIR)
                        print("  ✔ مزامنة GitHub اكتملت")
                    elif "nothing to commit" in (out.stdout or "").lower():
                        print("  - لا تغييرات فعلية في البيانات")
                last = fp
        except KeyboardInterrupt:
            print("تم إيقاف الواتشر.")
            break
        except Exception as e:
            print("خطأ:", e)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()