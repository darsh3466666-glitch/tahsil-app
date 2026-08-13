@echo off
REM تسجيل مهمة Windows لتشغيل واتشر التحصيل عند تسجيل الدخول
schtasks /Create /F /TN "TahsilWatcher" /TR "\"G:\Python312\pythonw.exe\" \"D:\Mostafa Ibrahim\tahsil-app\sync\watch.py\"" /SC ONLOGON /RL LIMITED
echo تم تسجيل المهمة. للتشغيل الآن: schtasks /Run /TN "TahsilWatcher"
