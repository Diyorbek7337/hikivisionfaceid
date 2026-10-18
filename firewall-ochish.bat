@echo off
chcp 65001 >nul
rem Windows Firewall da tizim portini ochadi (server\.env dagi PORT, bo'lmasa 3000),
rem shunda terminallar va boshqa kompyuterlar shu kompyuterga ulana oladi.
rem Bu faylni sichqonchaning o'ng tugmasi bilan bosib "Run as administrator" orqali ishga tushiring.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo [XATO] Administrator sifatida ishga tushiring: o'ng tugma - "Run as administrator".
  pause
  exit /b 1
)
set PORT=3000
if exist "server\.env" (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" "server\.env"') do if not "%%b"=="" set PORT=%%b
)
netsh advfirewall firewall delete rule name="Davomat tizimi" >nul 2>&1
netsh advfirewall firewall add rule name="Davomat tizimi" dir=in action=allow protocol=TCP localport=%PORT% profile=any
echo.
echo Tayyor: %PORT%-port ochildi.
pause
