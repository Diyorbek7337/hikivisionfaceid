@echo off
chcp 65001 >nul
title Davomat server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [XATO] Node.js o'rnatilmagan.
  echo https://nodejs.org saytidan "LTS" versiyasini yuklab o'rnating, keyin bu faylni qayta ishga tushiring.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo.
  echo [XATO] Node.js versiyasi eski. 22 yoki undan yangi versiya kerak. https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo .env fayli yaratildi. Hozir Bloknot ochiladi:
  echo   ADMIN_PASSWORD= qatoriga admin panel parolini yozing, saqlang va Bloknotni yoping.
  echo.
  notepad ".env"
)

if not exist "node_modules" (
  echo Kerakli paketlar o'rnatilmoqda...
  call npm install --omit=dev
  if errorlevel 1 (
    echo [XATO] npm install muvaffaqiyatsiz. Internet ulanishini tekshiring.
    pause
    exit /b 1
  )
)

echo.
echo Server ishga tushmoqda. Bu oynani YOPMANG - yopilsa server to'xtaydi.
echo.
call npm start
echo.
echo Server to'xtadi.
pause
