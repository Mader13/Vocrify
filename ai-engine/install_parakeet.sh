#!/bin/bash
# ============================================================================
# Parakeet ASR Model Installation Script for Linux/macOS
# ============================================================================
#
# This script helps install Parakeet models on Linux and macOS.
#
# Requirements:
# - Python 3.10-3.12 (NOT 3.13+)
# - ~2GB disk space
# - 5-10 minutes installation time
#
# Usage:
#   chmod +x install_parakeet.sh
#   ./install_parakeet.sh
#
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "========================================================================"
echo "Parakeet ASR Model Installation for Transcribe Video"
echo "========================================================================"
echo ""

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check Python version
echo "[1/6] Checking Python version..."
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 not found!"
    echo ""
    echo "Please install Python 3.12:"
    echo "  Ubuntu/Debian: sudo apt install python3.12 python3.12-venv"
    echo "  macOS: brew install python@3.12"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
print_success "Python $PYTHON_VERSION found"

# Check if version is 3.13+
if echo "$PYTHON_VERSION" | grep -qE "3\.1[3-9]"; then
    print_error "Python 3.13+ is NOT supported by NeMo Toolkit"
    echo ""
    echo "Please install Python 3.12 or earlier:"
    echo "  Ubuntu/Debian: sudo apt install python3.12 python3.12-venv"
    echo "  macOS: brew install python@3.12"
    exit 1
fi

print_success "Python version is compatible"
echo ""

# Check system dependencies
echo "[2/6] Checking system dependencies..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if ! command -v ffmpeg &> /dev/null; then
        print_warning "ffmpeg not found"
        echo "Installing ffmpeg..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y ffmpeg libsox-dev libsox-fmt-all
        elif command -v yum &> /dev/null; then
            sudo yum install -y ffmpeg sox-devel
        else
            print_error "Please install ffmpeg manually"
            exit 1
        fi
    fi
    print_success "System dependencies OK"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if ! command -v ffmpeg &> /dev/null; then
        print_warning "ffmpeg not found"
        echo "Installing ffmpeg via Homebrew..."
        brew install ffmpeg sox
    fi
    print_success "System dependencies OK"
else
    print_warning "Unknown OS: $OSTYPE"
fi
echo ""

# Check if in correct directory
echo "[3/6] Checking current directory..."
if [ ! -f "requirements.txt" ]; then
    print_error "requirements.txt not found!"
    echo ""
    echo "Please run this script from the ai-engine directory:"
    echo "  cd ai-engine"
    echo "  ./install_parakeet.sh"
    exit 1
fi
print_success "In correct directory"
echo ""

# Create virtual environment
echo "[4/6] Creating virtual environment..."
if [ -d "venv-parakeet" ]; then
    print_warning "venv-parakeet already exists"
    read -p "Recreate virtual environment? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf venv-parakeet
        python3 -m venv venv-parakeet
        print_success "Virtual environment recreated"
    else
        print_success "Using existing virtual environment"
    fi
else
    python3 -m venv venv-parakeet
    print_success "Virtual environment created"
fi
echo ""

# Activate virtual environment
echo "[5/6] Activating virtual environment..."
source venv-parakeet/bin/activate
print_success "Virtual environment activated"

# Upgrade pip
echo "Upgrading pip..."
python -m pip install --upgrade pip setuptools wheel > /dev/null 2>&1
print_success "pip upgraded"
echo ""

# Install requirements
echo "[6/6] Installing dependencies..."
echo "This may take 5-10 minutes..."
echo ""

echo "Installing base requirements..."
pip install -q -r requirements.txt
if [ $? -ne 0 ]; then
    print_error "Failed to install base requirements"
    exit 1
fi
print_success "Base requirements installed"

echo ""
echo "Installing Parakeet requirements..."
pip install -r requirements-parakeet.txt
if [ $? -ne 0 ]; then
    print_error "Failed to install Parakeet requirements"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Make sure you have Python 3.10-3.12"
    echo "  2. Check system dependencies: ffmpeg, libsox-dev"
    echo "  3. Try: pip install --upgrade pip"
    exit 1
fi
print_success "Parakeet requirements installed"
echo ""

# Verify installation
echo "========================================================================"
echo "Verifying Installation"
echo "========================================================================"
echo ""
python check_environment.py

# Final instructions
echo ""
echo "========================================================================"
print_success "Installation Complete!"
echo "========================================================================"
echo ""
echo "To use Parakeet models:"
echo ""
echo "1. Activate virtual environment:"
echo "   source venv-parakeet/bin/activate"
echo ""
echo "2. Test Parakeet:"
echo "   python main.py --test --model parakeet-tdt-0.6b-v3"
echo ""
echo "3. Transcribe audio:"
echo "   python main.py --file your-video.mp4 --model parakeet-tdt-0.6b-v3"
echo ""
echo "For more information, see: PARAKEET_SETUP.md"
echo ""
