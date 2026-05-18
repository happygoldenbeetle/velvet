@echo off
echo ==========================================
echo       Updating GitHub Repository...
echo ==========================================
echo.

:: Get the commit message from the first argument
set msg=%~1

:: If no message was provided, use a default timestamp message
if "%msg%"=="" set msg=Auto-update: %date% %time%

git add .
git commit -m "%msg%"
git push

echo.
echo ==========================================
echo           Update Complete!
echo ==========================================
pause
