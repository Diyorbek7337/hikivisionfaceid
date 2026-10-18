@echo off
chcp 65001 >nul
rem Windows Firewall da Node.js ga kiruvchi ulanishlarga ruxsat beradi (port qaysi bo'lishidan qat'i nazar),
rem shunda terminallar va boshqa kompyuterlar shu kompyuterga ulana oladi.
rem Bu faylni sichqonchaning o'ng tugmasi bilan bosib "Run as administrator" orqali ishga tushiring.
net session >nul 2>&1
if errorlevel 1 (
  echo [XATO] Administrator sifatida ishga tushiring: o'ng tugma - "Run as administrator".
  pause
  exit /b 1
)
set NODE_EXE=
for /f "delims=" %%n in ('where node') do if not defined NODE_EXE set NODE_EXE=%%n
if not defined NODE_EXE (
  echo [XATO] Node.js topilmadi. Avval Node.js ni o'rnating.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Davomat tizimi" >nul 2>&1
netsh advfirewall firewall delete rule name="Davomat server 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Davomat tizimi" dir=in action=allow program="%NODE_EXE%" enable=yes profile=any
echo.
echo Tayyor: %NODE_EXE% uchun ruxsat berildi.
pause
