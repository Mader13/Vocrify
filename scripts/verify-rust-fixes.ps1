#!/usr/bin/env pwsh
# Verification script for Rust backend fixes

Write-Host "=== Verifying Rust Backend Fixes ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Cargo check
Write-Host "Test 1: Running cargo check..." -ForegroundColor Yellow
$cargoCheck = cargo check --manifest-path="src-tauri/Cargo.toml" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Cargo check passed" -ForegroundColor Green
} else {
    Write-Host "✗ Cargo check failed" -ForegroundColor Red
    Write-Host $cargoCheck
    exit 1
}
Write-Host ""

# Test 2: Cargo test
Write-Host "Test 2: Running cargo test..." -ForegroundColor Yellow
$cargoTest = cargo test --manifest-path="src-tauri/Cargo.toml" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Cargo test passed" -ForegroundColor Green
} else {
    Write-Host "✗ Cargo test failed" -ForegroundColor Red
    Write-Host $cargoTest
    exit 1
}
Write-Host ""

# Test 3: Verify race condition fix
Write-Host "Test 3: Verifying race condition fix..." -ForegroundColor Yellow
$libContent = Get-Content "src-tauri/src/lib.rs" -Raw
if ($libContent -match "queue_processor_guard:\s*Arc<tokio::sync::Mutex<\(\)>>") {
    Write-Host "✓ Queue processor guard correctly implemented" -ForegroundColor Green
} else {
    Write-Host "✗ Queue processor guard not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 4: Verify venv detection improvements
Write-Host "Test 4: Verifying venv detection improvements..." -ForegroundColor Yellow
if ($libContent -match "venv_paths\s*=\s*vec!") {
    Write-Host "✓ Multiple venv paths implemented" -ForegroundColor Green
} else {
    Write-Host "✗ Multiple venv paths not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 5: Verify error handling improvements
Write-Host "Test 5: Verifying error handling improvements..." -ForegroundColor Yellow
$improvedErrors = @(
    "Ensure Python 3.8-3.12 is installed",
    "Check the application logs for detailed error information",
    "Check your internet connection and HuggingFace token"
)
$foundErrors = 0
foreach ($pattern in $improvedErrors) {
    if ($libContent -match [regex]::Escape($pattern)) {
        $foundErrors++
    }
}
if ($foundErrors -eq $improvedErrors.Count) {
    Write-Host "✓ All error handling improvements found ($foundErrors/$($improvedErrors.Count))" -ForegroundColor Green
} else {
    Write-Host "✗ Some error handling improvements missing ($foundErrors/$($improvedErrors.Count))" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Summary
Write-Host "=== All Verification Tests Passed ===" -ForegroundColor Green
Write-Host ""
Write-Host "Summary of fixes:" -ForegroundColor Cyan
Write-Host "  1. Fixed task queue race condition with Arc<Mutex<()>>"
Write-Host "  2. Improved venv detection with multiple fallback paths"
Write-Host "  3. Enhanced error messages with actionable guidance"
Write-Host ""
Write-Host "For detailed documentation, see: docs/rust-backend-fixes.md"
Write-Host ""
