#!/bin/bash
# Comprehensive diarization test runner
# Tests all layers: Python, Rust, and Frontend

set -e  # Exit on error

echo "========================================"
echo "Diarization End-to-End Test Suite"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PYTHON_TESTS_PASSED=true
RUST_TESTS_PASSED=true
INTEGRATION_TESTS_PASSED=true

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Project root: $PROJECT_ROOT"
echo ""

# ==========================================
# 1. Python Unit Tests
# ==========================================
echo -e "${YELLOW}Running Python Unit Tests...${NC}"
echo "========================================"

cd ai-engine

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${RED}Error: Python virtual environment not found${NC}"
    echo "Please run: cd ai-engine && fix_environment.bat"
    PYTHON_TESTS_PASSED=false
else
    # Activate virtual environment
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        source venv/Scripts/activate
    else
        source venv/bin/activate
    fi

    # Run Python tests
    echo "Running: pytest ../tests/unit/python/test_diarization_providers.py -v"
    if pytest ../tests/unit/python/test_diarization_providers.py -v; then
        echo -e "${GREEN}Python unit tests PASSED${NC}"
    else
        echo -e "${RED}Python unit tests FAILED${NC}"
        PYTHON_TESTS_PASSED=false
    fi

    deactivate
fi

echo ""

# ==========================================
# 2. Rust Unit Tests
# ==========================================
echo -e "${YELLOW}Running Rust Unit Tests...${NC}"
echo "========================================"

cd "$PROJECT_ROOT"

if [ -f "src-tauri/Cargo.toml" ]; then
    echo "Running: cargo test --manifest-path=src-tauri/Cargo.toml"
    if cargo test --manifest-path=src-tauri/Cargo.toml; then
        echo -e "${GREEN}Rust unit tests PASSED${NC}"
    else
        echo -e "${RED}Rust unit tests FAILED${NC}"
        RUST_TESTS_PASSED=false
    fi
else
    echo -e "${RED}Error: src-tauri/Cargo.toml not found${NC}"
    RUST_TESTS_PASSED=false
fi

echo ""

# ==========================================
# 3. Integration Tests (Manual)
# ==========================================
echo -e "${YELLOW}Integration Tests (Manual)...${NC}"
echo "========================================"
echo ""
echo "The following manual tests should be performed:"
echo ""
echo "1. Start the application: bun run tauri:dev"
echo "2. Test Sherpa-ONNX diarization:"
echo "   - Install sherpa-onnx-diarization model"
echo "   - Drop an audio file with multiple speakers"
echo "   - Enable diarization with sherpa-onnx provider"
echo "   - Start transcription"
echo "   - Verify speaker labels appear in results"
echo "   - Verify waveform shows different colors for speakers"
echo ""
echo "3. Test PyAnnote diarization:"
echo "   - Set HuggingFace token in settings"
echo "   - Install pyannote-diarization model"
echo "   - Drop an audio file with multiple speakers"
echo "   - Enable diarization with pyannote provider"
echo "   - Start transcription"
echo "   - Verify speaker labels appear in results"
echo ""
echo "4. Test error handling:"
echo "   - Try pyannote without token (should show clear error)"
echo "   - Try diarization with no models installed"
echo "   - Verify error messages are helpful"
echo ""
read -p "Have you completed the manual integration tests? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Integration tests marked as incomplete${NC}"
    INTEGRATION_TESTS_PASSED=false
fi

echo ""

# ==========================================
# Test Summary
# ==========================================
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ "$PYTHON_TESTS_PASSED" = true ]; then
    echo -e "Python Unit Tests: ${GREEN}PASSED${NC}"
else
    echo -e "Python Unit Tests: ${RED}FAILED${NC}"
fi

if [ "$RUST_TESTS_PASSED" = true ]; then
    echo -e "Rust Unit Tests:   ${GREEN}PASSED${NC}"
else
    echo -e "Rust Unit Tests:   ${RED}FAILED${NC}"
fi

if [ "$INTEGRATION_TESTS_PASSED" = true ]; then
    echo -e "Integration Tests: ${GREEN}PASSED${NC}"
else
    echo -e "Integration Tests: ${YELLOW}INCOMPLETE${NC}"
fi

echo ""

if [ "$PYTHON_TESTS_PASSED" = true ] && [ "$RUST_TESTS_PASSED" = true ] && [ "$INTEGRATION_TESTS_PASSED" = true ]; then
    echo -e "${GREEN}All tests PASSED!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed or incomplete${NC}"
    exit 1
fi
