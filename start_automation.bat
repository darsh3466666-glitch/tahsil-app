@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title منظومة أتمتة التحصيل - تليجرام وواتساب
echo ========================================================
echo   🚀 جاري تشغيل منظومة أتمتة التحصيل والتقارير الصباحية
echo   🤖 بوت تليجرام: @Noorfeedbot (النور للاعلاف)
echo   ⏰ موعد التقرير اليومي: 10:00 صباحاً على تليجرام
echo ========================================================
echo.

if exist "G:\Python312\python.exe" (
    "G:\Python312\python.exe" automation\auto_sync_engine.py
) else (
    py automation\auto_sync_engine.py
)

pause
