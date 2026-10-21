@echo off
chcp 65001 >nul
rem Parol esdan chiqsa: veb ilova foydalanuvchisiga yangi parol qo'yadi (faqat shu kompyuterda ishlaydi).
cd /d "%~dp0server"
node --no-warnings=ExperimentalWarning scripts\parol-tiklash.js
echo.
pause
