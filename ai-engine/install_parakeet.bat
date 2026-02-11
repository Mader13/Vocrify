@echo off
REM ============================================================================
REM Parakeet ASR Model Installation Script for Windows
REM ============================================================================
REM
REM This script helps install Parakeet models on Windows.
REM
REM IMPORTANT:
REM - Python 3.10-3.12 REQUIRED (NOT 3.13+)
REM - WSL2 is RECOMMENDED for Windows (native Windows support is limited)
REM - Requires ~2GB disk space
REM - Installation takes 5-10 minutes
REM
REM Usage:
REM   install_parakeet.bat
REM
REM ============================================================================

echo.
echo ========================================================================
echo Parakeet ASR Model Installation for Transcribe Video
echo ========================================================================
echo.

REM Check Python version
echo [1/6] Checking Python version...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python not found!
    echo.
    echo Please install Python 3.12 from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo ✅ Python %PYTHON_VERSION% found

REM Check if version is 3.13+
echo %PYTHON_VERSION% | findstr /R "3\.1[3-9]" >nul
if not errorlevel 1 (
    echo ❌ Python 3.13+ is NOT supported by NeMo Toolkit
    echo.
    echo Please install Python 3.12 or earlier:
    echo   1. Download from: https://www.python.org/downloads/
    echo   2. Install Python 3.12
    echo   3. Re-run this script
    pause
    exit /b 1
)

echo ✅ Python version is compatible
echo.

REM Ask about installation method
echo [2/6] Choose installation method:
echo.
echo   1. Native Windows (Experimental - may have issues)
echo   2. WSL2 (Recommended - full support)
echo.
set /p INSTALL_METHOD="Enter choice (1 or 2): "

if "%INSTALL_METHOD%"=="2" (
    echo.
    echo ========================================================================
    echo WSL2 Installation Instructions
    echo ========================================================================
    echo.
    echo To install Parakeet with WSL2:
    echo.
    echo 1. Install WSL2:
    echo    wsl --install -d Ubuntu
    echo.
    echo 2. Restart your computer
    echo.
    echo 3. Open WSL2 Ubuntu and run:
    echo    sudo apt update
    echo    sudo apt install -y python3.12 python3.12-venv ffmpeg libsox-dev
    echo    cd /mnt/e/Dev/Transcribe-video/ai-engine
    echo    python3.12 -m venv venv-parakeet
    echo    source venv-parakeet/bin/activate
    echo    pip install -r requirements.txt
    echo    pip install -r requirements-parakeet.txt
    echo.
    echo 4. Verify installation:
    echo    python check_environment.py
    echo.
    pause
    exit /b 0
)

REM Warn about Windows limitations
echo.
echo ========================================================================
echo ⚠️  WARNING: Native Windows Support is Limited
echo ========================================================================
echo.
echo NeMo Toolkit has limited support on native Windows.
echo You may encounter:
echo   - Build errors
echo   - Missing dependencies
echo   - Performance issues
echo.
echo Strongly recommend using WSL2 instead.
echo.
set /p CONTINUE="Continue with native Windows installation? (y/N): "
if /i not "%CONTINUE%"=="y" (
    echo Installation cancelled.
    pause
    exit /b 0
)

REM Check if in correct directory
echo.
echo [3/6] Checking current directory...
if not exist "requirements.txt" (
    echo ❌ requirements.txt not found!
    echo.
    echo Please run this script from the ai-engine directory:
    echo   cd ai-engine
    echo   install_parakeet.bat
    pause
    exit /b 1
)
echo ✅ In correct directory

REM Create virtual environment
echo.
echo [4/6] Creating virtual environment...
if exist "venv-parakeet" (
    echo ⚠️  venv-parakeet already exists
    set /p RECREATE="Recreate virtual environment? (y/N): "
    if /i "%RECREATE%"=="y" (
        rmdir /s /q venv-parakeet
        python -m venv venv-parakeet
        echo ✅ Virtual environment recreated
    ) else (
        echo ✅ Using existing virtual environment
    )
) else (
    python -m venv venv-parakeet
    echo ✅ Virtual environment created
)

REM Activate virtual environment
echo.
echo [5/6] Activating virtual environment...
call venv-parakeet\Scripts\activate.bat
if errorlevel 1 (
    echo ❌ Failed to activate virtual environment
    pause
    exit /b 1
)
echo ✅ Virtual environment activated

REM Upgrade pip
echo.
echo Upgrading pip...
python -m pip install --upgrade pip setuptools wheel
echo ✅ pip upgraded

REM Install requirements
echo.
echo [6/6] Installing dependencies...
echo This may take 5-10 minutes...
echo.

echo Installing base requirements...
pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ Failed to install base requirements
    pause
    exit /b 1
)
echo ✅ Base requirements installed

echo.
echo Installing Parakeet requirements...
pip install -r requirements-parakeet.txt
if errorlevel 1 (
    echo ❌ Failed to install Parakeet requirements
    echo.
    echo Troubleshooting:
    echo   1. Make sure you have Visual Studio Build Tools installed
    echo   2. Check that Python 3.12 is being used
    echo   3. Try WSL2 installation instead
    pause
    exit /b 1
)
echo ✅ Parakeet requirements installed

REM Verify installation
echo.
echo ========================================================================
echo Verifying Installation
echo ========================================================================
echo.
python check_environment.py

REM Final instructions
echo.
echo ========================================================================
echo ✅ Installation Complete!
echo ========================================================================
echo.
echo To use Parakeet models:
echo.
echo 1. Activate virtual environment:
echo    venv-parakeet\Scripts\activate
echo.
echo 2. Test Parakeet:
echo    python main.py --test --model parakeet-tdt-0.6b-v3
echo.
echo 3. Transcribe audio:
echo    python main.py --file your-video.mp4 --model parakeet-tdt-0.6b-v3
echo.
echo For more information, see: PARAKEET_SETUP.md
echo.
pause
