@echo off
title HanlawQ local server
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8

REM 글자가 바로 보이게 (검은 화면만 보일 때 대비)
echo.
echo ========================================
echo   HanlawQ - local server
echo ========================================
echo.

cd /d "%~dp0"
echo [OK] Folder:
echo     %CD%
echo.

set "PORT=5500"
set "PYEXE="

where py >nul 2>&1
if not errorlevel 1 set "PYEXE=py"

if not defined PYEXE (
  where python >nul 2>&1
  if not errorlevel 1 set "PYEXE=python"
)

if not defined PYEXE (
  echo [ERROR] Python not found. Install Python 3 and add to PATH.
  echo https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo [OK] Python:
"%PYEXE%" --version
if errorlevel 1 (
  echo [ERROR] Cannot run Python.
  pause
  exit /b 1
)

if not exist "index.html" (
  echo [ERROR] index.html not found in this folder.
  echo Run this file from the HanlawQ project folder ^(same folder as index.html^).
  echo.
  pause
  exit /b 1
)

netstat -ano 2>nul | findstr "LISTENING" | findstr ":%PORT%" >nul 2>&1
if not errorlevel 1 (
  echo [WARN] Port %PORT% is already in use. Close other servers or change PORT in this file.
  echo.
  pause
)

echo.
echo Starting serve-localhost.py ...
echo If the screen stays blank for 10+ seconds, press Ctrl+C and tell us.
echo.

"%PYEXE%" -u "%~dp0serve-localhost.py" %PORT%
set "ERR=%ERRORLEVEL%"
echo.
echo Exit code: %ERR%
pause
exit /b %ERR%
