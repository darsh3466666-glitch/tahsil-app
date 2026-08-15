# watch.py — مراقبة شيت تحصيل.xlsm وتحديث GitHub تلقائياً
# يعمل في الخلفية بصمت: كل 30 ثانية يفحص إذا تغيّر الشيت؛ عند أي تغيير يعيد تصدير data.json
# ويدفع التحديث لـ GitHub (git add + commit + push) فيتحدث الموقع لايف.
# السجلّ مكتوب في watcher.log (بدون أي نافذة)
import os, sys, time, hashlib, subprocess, traceback

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(SCRIPT_DIR, "watcher.log")


def log(msg):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass


if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
else:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
else:
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SHEET_PATH = r"D:\Mostafa Ibrahim\شيت تحصيل.xlsm"
REPO_DIR = os.path.dirname(SCRIPT_DIR)
PYTHON = r"G:\Python312\pythonw.exe"
POLL_SECONDS = 30


def file_fingerprint(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def run(cmd, cwd):
    creation_flags = 0
    startupinfo = None
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NO_WINDOW
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
    r = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
        startupinfo=startupinfo
    )
    if r.returncode != 0:
        log(f"CMD FAIL {' '.join(cmd)}: {r.stderr[:500]}")
    return r


def main():
    log("Watcher بدأ (فترة الفحص: %ss)" % POLL_SECONDS)
    last = None
    while True:
        try:
            fp = file_fingerprint(SHEET_PATH)
            if fp is None:
                log("! الشيت غير متاح (مقفول أو محذوف؟) — الانتظار...")
            elif fp != last:
                if last is not None:
                    time.sleep(5)  # مهلة أغفال حفاض Excel
                    log("تغيّر الشيت — تصدير...")
                    r = run([PYTHON, os.path.join(SCRIPT_DIR, "extract.py")], REPO_DIR)
                    ok = r.returncode == 0
                    if not ok:
                        log("  تصدير فشل — سيحاول مجدداً في الدورة القادمة")
                        last = None  # أعد الفحص بنفس الحالة عند الفشل
                        continue
                    # دفع لـ GitHub
                    run(["git", "add", "-A"], REPO_DIR)
                    out = run(["git", "commit", "-m", f"تحديث تلقائي: {time.strftime('%Y-%m-%d %H:%M')}", "--no-gpg-sign"], REPO_DIR)
                    if out.returncode == 0 and "nothing to commit" not in out.stdout.lower():
                        run(["git", "push", "origin", "main"], REPO_DIR)
                        log("  ✔ مزامنة GitHub اكتملت")
                    elif "nothing to commit" in (out.stdout or "").lower():
                        log("  - لا تغييرات فعلية في البيانات")
                last = fp
        except KeyboardInterrupt:
            log("تم إيقاف الواتشر.")
            break
        except Exception as e:
            log(f"خطأ: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
