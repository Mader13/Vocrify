@echo off
REM Comprehensive diarization test runner for Windows
REM Tests all layers: Python, Rust, and Frontend

setlocal enabledelayedexpansion

echo ========================================
echo Diarization End-to-End Test Suite
echo ========================================
echo.

REM Project root
set PROJECT_ROOT=%~dp0..
cd /d "%PROJECT_ROOT%"

echo Project root: %PROJECT_ROOT%
echo.

REM ==========================================
REM 1. Python Unit Tests
REM ==========================================
echo Running Python Unit Tests...
echo ========================================

cd ai-engine

REM Check if virtual environment exists
if not exist "venv" (
    echo [ERROR] Python virtual environment not found
    echo Please run: cd ai-engine ^&^& fix_environment.bat
    set PYTHON_TESTS_PASSED=false
    goto :rust_tests
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Run Python tests
echo Running: pytest ..\tests\unit\python\test_diarization_providers.py -v
python -m pytest ..\tests\unit\python\test_diarization_providers.py -v
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Python unit tests PASSED
    set PYTHON_TESTS_PASSED=true
) else (
    echo [ERROR] Python unit tests FAILED
    set PYTHON_TESTS_PASSED=false
)

deactivate

echo.

:rust_tests

REM ==========================================
REM 2. Rust Unit Tests
REM ==========================================
echo Running Rust Unit Tests...
echo ========================================

cd /d "%PROJECT_ROOT%"

if exist "src-tauri\Cargo.toml" (
    echo Running: cargo test --manifest-path=src-tauri\Cargo.toml
    cargo test --manifest-path=src-tauri\Cargo.toml
    if %ERRORLEVEL% EQU 0 (
        echo [SUCCESS] Rust unit tests PASSED
        set RUST_TESTS_PASSED=true
    ) else (
        echo [ERROR] Rust unit tests FAILED
        set RUST_TESTS_PASSED=false
    )
) else (
    echo [ERROR] src-tauri\Cargo.toml not found
    set RUST_TESTS_PASSED=false
)

echo.

REM ==========================================
REM 3. Integration Tests (Manual)
REM ==========================================
echo Integration Tests ^(Manual^)...
echo ========================================
echo.
echo The following manual tests should be performed:
echo.
echo 1. Start the application: bun run tauri:dev
echo 2. Test Sherpa-ONNX diarization:
echo    - Install sherpa-onnx-diarization model
echo    - Drop an audio file with multiple speakers
echo    - Enable diarization with sherpa-onnx provider
echo    - Start transcription
echo    - Verify speaker labels appear in results
echo    - Verify waveform shows different colors for speakers
echo.
echo 3. Test PyAnnote diarization:
echo    - Set HuggingFace token in settings
echo    - Install pyannote-diarization model
echo    - Drop an audio file with multiple speakers
echo    - Enable diarization with pyannote provider
echo    - Start transcription
echo    - Verify speaker labels appear in results
echo.
echo 4. Test error handling:
echo    - Try pyannote without token ^(should show clear error^)
echo    - Try diarization with no models installed
echo    - Verify error messages are helpful
echo.
set /p MANUAL_COMPLETE="Have you completed the manual integration tests? (y/n) "
if /i not "%MANUAL_COMPLETE%"=="y" (
    echo [WARNING] Integration tests marked as incomplete
    set INTEGRATION_TESTS_PASSED=false
) else (
    set INTEGRATION_TESTS_PASSED=true
)

echo.

REM ==========================================
REM Test Summary
REM ==========================================
echo ========================================
echo Test Summary
echo ========================================

if "%PYTHON_TESTS_PASSED%"=="true" (
    echo Python Unit Tests: [PASSED]
) else (
    echo Python Unit Tests: [FAILED]
)

if "%RUST_TESTS_PASSED%"=="true" (
    echo Rust Unit Tests:   [PASSED]
) else (
    echo Rust Unit Tests:   [FAILED]
)

if "%INTEGRATION_TESTS_PASSED%"=="true" (
    echo Integration Tests: [PASSED]
) else (
    echo Integration Tests: [INCOMPLETE]
)

echo.

if "%PYTHON_TESTS_PASSED%"=="true" if "%RUST_TESTS_PASSED%"=="true" if "%INTEGRATION_TESTS_PASSED%"=="true" (
    echo All tests PASSED!
    exit /b 0
) else (
    echo Some tests failed or incomplete
    exit /b 1
)
