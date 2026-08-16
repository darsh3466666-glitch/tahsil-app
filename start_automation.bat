@echo off
chcp 65001 >nul
title منظومة أتمتة التحصيل - تليجرام وإكسيل وواتساب
echo ========================================================
echo   🚀 جاري تشغيل منظومة أتمتة التحصيل والتقارير الصباحية
echo   ⏰ موعد التقرير اليومي: 10:00 صباحاً على تليجرام
echo ========================================================
echo.

if exist "G:\Python312\python.exe" (
    "G:\Python312\python.exe" automation\auto_sync_engine.py
) else (
    py automation\auto_sync_engine.py
)

pause
