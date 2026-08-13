# منصة التحصيل — لوحة متابعة السداد (GitHub Pages)

لوحة ويب متجددة تلقائياً من ملف **شيت تحصيل.xlsm** في `D:\Mostafa Ibrahim\شيت تحصيل.xlsm`.

## مميزات
- لوحة تحكم بأرقام اليوم (أهداف التحصيل، ما تم، مناقص)
- خط سير المحصلين (مصطفى / عبد الرحمن) بفلترة العميل
- تقييم أداء المحصلين وردود العملاء حسب معادلات الشيت
- تنبيه صوتي + إشعار متصفح عند أي سداد/فاتورة جديدة
- تحديث تلقائي: أي حفظ للشيت → إعادة تصدير → نشر على الموقع

## البنية
| المسار | الوظيفة |
|---|---|
| `index.html` + `styles.css` + `app.js` | الموقع (يقرأ `data/data.json`) |
| `data/data.json` | البيانات المصدرة من الشيت (يُحدثها الواتشر) |
| `sync/extract.py` | تصدير الشيت → JSON (بدون مكتبات خارجية) |
| `sync/watch.py` | مراقبة الشيت كل 30 ثانية + دفع تلقائي لـ GitHub |
| `sync/setup_task.bat` | تسجيل مهمة Windows تعمل عند تسجيل الدخول |

## خطوات النشر (مرة واحدة)
1. تسجيل الدخول لـ GitHub:
   ```
   gh auth login
   ```
2. إنشاء الريبو ورفع الكود (من داخل مجلد المشروع):
   ```
   cd D:\Mostafa Ibrahim\tahsil-app
   gh repo create tahsil-app --source . --push --public
   ```
3. تفعيل GitHub Pages (المصدر: main / root):
   ```
   gh api repos/USER/tahsil-app/pages -X POST -f "source[branch]=main" -f "source[path]=/"
   ```
   → الموقع يظهر على `https://USER.github.io/tahsil-app/` (انتظر 1-2 دقيقة).

## التشغيل التلقائي
- شغّل مرة: `schtasks /Run /TN "TahsilWatcher"`
- أو لتشغيله عند كل تسجيل دخول: `sync\setup_task.bat`
- يظل الواتشر يراقب الشيت ويدفع التحديثات تلقائياً.

## ملاحظات
- إضافة عمود `رقم الهاتف` (عمود U في Master_Data) يعرّض أرقام العملاء في الموقع تلقائياً.
- لإيقاف الواتشر: `schtasks /End /TN "TahsilWatcher"`
