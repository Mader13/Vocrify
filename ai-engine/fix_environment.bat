@echo off
REM Transcribe Video - AI Engine Environment Fix Script
REM This script helps set up the correct Python environment

echo ======================================================================
echo Transcribe Video - AI Engine Environment Fix
echo ======================================================================
echo.

REM Check if Python 3.12 is available
echo [1/6] Checking for Python 3.12...
py -3.12 --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo OK: Python 3.12 found
    py -3.12 --version
) else (
    echo ERROR: Python 3.12 not found
    echo.
    echo Please install Python 3.12 from:
    echo https://www.python.org/downloads/
    echo.
    echo During installation:
    echo - Check "Add Python 3.12 to PATH"
    echo.
    pause
    exit /b 1
)
echo.

REM Remove old venv if exists
echo [2/6] Removing old virtual environment (if exists)...
if exist venv (
    echo Removing existing venv directory...
    rmdir /s /q venv
    echo OK: Old venv removed
) else (
    echo OK: No existing venv found
)
echo.

REM Create new venv with Python 3.12
echo [3/6] Creating new virtual environment with Python 3.12...
py -3.12 -m venv venv
if %ERRORLEVEL% EQU 0 (
    echo OK: Virtual environment created
) else (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)
echo.

REM Activate venv
echo [4/6] Activating virtual environment...
call venv\Scripts\activate.bat
if %ERRORLEVEL% EQU 0 (
    echo OK: Virtual environment activated
) else (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)
echo.

REM Upgrade pip
echo [5/6] Upgrading pip...
python -m pip install --upgrade pip
if %ERRORLEVEL% EQU 0 (
    echo OK: pip upgraded
) else (
    echo WARNING: Failed to upgrade pip (continuing anyway)
)
echo.

REM Install dependencies
echo [6/6] Installing dependencies from requirements.txt...
echo This may take several minutes...
pip install -r requirements.txt
if %ERRORLEVEL% EQU 0 (
    echo OK: Dependencies installed
) else (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo.

REM Test installation
echo ======================================================================
echo Testing installation...
echo ======================================================================
python check_environment.py
echo.

echo ======================================================================
echo Setup complete!
echo ======================================================================
echo.
echo To activate the virtual environment in the future:
echo   venv\Scripts\activate
echo.
echo To test the AI engine:
echo   python main.py --test
echo.
echo For more information, see PYTHON_SETUP.md
echo ======================================================================
pause
