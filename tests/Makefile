# Makefile for running tests in Transcribe Video project
# Provides convenient shortcuts for common test commands

.PHONY: help test test-python test-rust test-integration test-e2e test-all clean coverage

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

help:
	@echo "$(BLUE)Transcribe Video - Test Commands$(NC)"
	@echo ""
	@echo "Available targets:"
	@echo "  $(GREEN)make test$(NC)                 - Run all quick tests (unit only)"
	@echo "  $(GREEN)make test-all$(NC)             - Run all tests including slow/e2e"
	@echo "  $(GREEN)make test-python$(NC)          - Run Python unit tests"
	@echo "  $(GREEN)make test-rust$(NC)            - Run Rust unit tests"
	@echo "  $(GREEN)make test-integration$(NC)     - Run integration tests"
	@echo "  $(GREEN)make test-e2e$(NC)             - Run end-to-end tests"
	@echo "  $(GREEN)make test-download$(NC)        - Run download-related tests only"
	@echo "  $(GREEN)make coverage$(NC)             - Generate coverage reports"
	@echo "  $(GREEN)make coverage-html$(NC)        - Generate HTML coverage report"
	@echo "  $(GREEN)make clean$(NC)                - Clean test artifacts"
	@echo ""
	@echo "Advanced options:"
	@echo "  $(GREEN)make test-python-verbose$(NC)  - Run Python tests with verbose output"
	@echo "  $(GREEN)make test-rust-verbose$(NC)    - Run Rust tests with verbose output"
	@echo "  $(GREEN)make test-watch$(NC)           - Watch for changes and re-run tests"

test:
	@echo "$(BLUE)Running quick unit tests...$(NC)"
	@cd tests && pytest unit/python/ -m "not slow" -q
	@echo "$(GREEN)✓ Python tests passed$(NC)"
	@cargo test --manifest-path=../src-tauri/Cargo.toml --quiet
	@echo "$(GREEN)✓ Rust tests passed$(NC)"

test-all:
	@echo "$(BLUE)Running all tests...$(NC)"
	@cd tests && pytest unit/python/ -v
	@cargo test --manifest-path=../src-tauri/Cargo.toml
	@echo "$(GREEN)✓ All tests passed$(NC)"

test-python:
	@echo "$(BLUE)Running Python unit tests...$(NC)"
	@cd tests && pytest unit/python/ -v
	@echo "$(GREEN)✓ Python tests passed$(NC)"

test-python-verbose:
	@echo "$(BLUE)Running Python tests (verbose)...$(NC)"
	@cd tests && pytest unit/python/ -vv -s

test-python-quick:
	@echo "$(BLUE)Running quick Python tests...$(NC)"
	@cd tests && pytest unit/python/ -m "not slow" -q

test-rust:
	@echo "$(BLUE)Running Rust unit tests...$(NC)"
	@cargo test --manifest-path=src-tauri/Cargo.toml
	@echo "$(GREEN)✓ Rust tests passed$(NC)"

test-rust-verbose:
	@echo "$(BLUE)Running Rust tests (verbose)...$(NC)"
	@cargo test --manifest-path=src-tauri/Cargo.toml -- --nocapture

test-integration:
	@echo "$(BLUE)Running integration tests...$(NC)"
	@cd tests/integration && bun test
	@echo "$(GREEN)✓ Integration tests passed$(NC)"

test-e2e:
	@echo "$(YELLOW)Running end-to-end tests...$(NC)"
	@cd tests/e2e && bun test
	@echo "$(GREEN)✓ E2E tests passed$(NC)"

test-download:
	@echo "$(BLUE)Running download-related tests...$(NC)"
	@cd tests && pytest unit/python/test_downloader.py -v
	@cargo test --manifest-path=src-tauri/Cargo.toml download_manager
	@echo "$(GREEN)✓ Download tests passed$(NC)"

test-security:
	@echo "$(BLUE)Running security tests...$(NC)"
	@cd tests && pytest unit/python/ -m security -v
	@echo "$(GREEN)✓ Security tests passed$(NC)"

test-performance:
	@echo "$(BLUE)Running performance tests...$(NC)"
	@cd tests && pytest unit/python/ -m performance -v
	@echo "$(GREEN)✓ Performance tests passed$(NC)"

coverage:
	@echo "$(BLUE)Generating coverage reports...$(NC)"
	@cd tests && pytest unit/python/ --cov=../ai-engine --cov-report=term-missing
	@echo "$(GREEN)✓ Coverage report generated$(NC)"

coverage-html:
	@echo "$(BLUE)Generating HTML coverage report...$(NC)"
	@cd tests && pytest unit/python/ --cov=../ai-engine --cov-report=html
	@echo "$(GREEN)✓ HTML coverage report generated: tests/htmlcov/index.html$(NC)"
	@echo "$(YELLOW)Opening in browser...$(NC)"
	@if command -v xdg-open >/dev/null 2>&1; then \
		xdg-open tests/htmlcov/index.html; \
	elif command -v open >/dev/null 2>&1; then \
		open tests/htmlcov/index.html; \
	elif command -v start >/dev/null 2>&1; then \
		start tests/htmlcov/index.html; \
	else \
		echo "Please open tests/htmlcov/index.html in your browser"; \
	fi

coverage-rust:
	@echo "$(BLUE)Generating Rust coverage report...$(NC)"
	@cargo tarpaulin --manifest-path=src-tauri/Cargo.toml --out Html
	@echo "$(GREEN)✓ Rust coverage report generated$(NC)"

test-watch:
	@echo "$(BLUE)Watching for changes...$(NC)"
	@cd tests && pytest-watch unit/python/ -v

clean:
	@echo "$(BLUE)Cleaning test artifacts...$(NC)"
	@rm -rf tests/htmlcov/
	@rm -f tests/.coverage
	@rm -f tests/coverage.xml
	@rm -rf tests/.pytest_cache/
	@rm -rf tests/__pycache__/
	@rm -rf tests/unit/python/__pycache__/
	@cargo clean --manifest-path=src-tauri/Cargo.toml
	@echo "$(GREEN)✓ Clean complete$(NC)"

install-deps:
	@echo "$(BLUE)Installing test dependencies...$(NC)"
	@pip install -r tests/requirements.txt
	@echo "$(GREEN)✓ Python test dependencies installed$(NC)"

lint-python:
	@echo "$(BLUE)Linting Python code...$(NC)"
	@cd tests && pylint ../ai-engine/*.py
	@echo "$(GREEN)✓ Linting complete$(NC)"

format-python:
	@echo "$(BLUE)Formatting Python code...$(NC)"
	@black tests/unit/python/*.py
	@echo "$(GREEN)✓ Formatting complete$(NC)"

format-rust:
	@echo "$(BLUE)Formatting Rust code...$(NC)"
	@cargo fmt --manifest-path=src-tauri/Cargo.toml
	@echo "$(GREEN)✓ Formatting complete$(NC)"

check:
	@echo "$(BLUE)Running pre-commit checks...$(NC)"
	@make test-python-quick
	@make test-rust
	@make lint-python
	@echo "$(GREEN)✓ All checks passed$(NC)"

# CI/CD targets
ci-test:
	@echo "$(BLUE)Running CI test suite...$(NC)"
	@cd tests && pytest unit/python/ -m "not slow" --cov=../ai-engine --cov-report=xml
	@cargo test --manifest-path=src-tauri/Cargo.toml
	@echo "$(GREEN)✓ CI tests passed$(NC)"

ci-coverage:
	@echo "$(BLUE)Generating CI coverage...$(NC)"
	@cd tests && pytest unit/python/ --cov=../ai-engine --cov-report=xml --cov-report=term
	@echo "$(GREEN)✓ CI coverage generated$(NC)"

# Help for specific test files
test-downloader-python:
	@cd tests && pytest unit/python/test_downloader.py -v

test-downloader-rust:
	@cargo test --manifest-path=src-tauri/Cargo.toml test_download_manager

# Parallel test execution
test-parallel:
	@echo "$(BLUE)Running tests in parallel...$(NC)"
	@cd tests && pytest unit/python/ -n auto
	@echo "$(GREEN)✓ Parallel tests complete$(NC)"
