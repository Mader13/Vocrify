//! Python Installer Module
//!
//! This module handles automatic Python installation for the application.
//! It downloads embeddable Python, installs pip, PyTorch, and dependencies.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

const PYTHON_VERSION: &str = "3.12.10";
const GET_PIP_URL: &str = "https://bootstrap.pypa.io/get-pip.py";
const SUPPORTED_SYSTEM_PYTHON: &[(u32, u32)] = &[(3, 10), (3, 11), (3, 12)];

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Target for PyTorch installation
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TorchInstallTarget {
    Cuda,
    Cpu,
}

/// Returns true if torch should be installed or upgraded for the given target.
///
/// - `torch_installed`: whether any version of torch is currently installed
/// - `has_cuda_build`: whether the currently installed torch is a CUDA build
pub fn should_install_or_upgrade_torch(
    target: TorchInstallTarget,
    torch_installed: bool,
    has_cuda_build: bool,
) -> bool {
    match target {
        TorchInstallTarget::Cuda => {
            // Need to install/upgrade when torch is missing or the existing build lacks CUDA
            !torch_installed || !has_cuda_build
        }
        TorchInstallTarget::Cpu => {
            // For CPU-only we only install when torch is missing; no upgrade needed
            !torch_installed
        }
    }
}

#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn create_hidden_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> Command {
    let mut cmd = Command::new(program.as_ref());
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
pub fn create_hidden_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> Command {
    let mut cmd = Command::new(program.as_ref());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd
}

#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn create_hidden_std_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> StdCommand {
    let mut cmd = StdCommand::new(program.as_ref());
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
pub fn create_hidden_std_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> StdCommand {
    let mut cmd = StdCommand::new(program.as_ref());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd
}

fn parse_python_major_minor(version_text: &str) -> Option<(u32, u32)> {
    // NOTE: `?` inside a for-loop body exits the whole function, not just the iteration.
    // Use an inner closure to safely try parsing each token without short-circuiting the loop.
    for token in version_text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        let result = (|| -> Option<(u32, u32)> {
            let mut parts = cleaned.split('.');
            let major = parts.next()?.parse::<u32>().ok()?;
            let minor = parts.next()?.parse::<u32>().ok()?;
            // Reject implausible values (guard against e.g. "3." or malformed tokens)
            if major == 0 && minor == 0 {
                return None;
            }
            Some((major, minor))
        })();
        if result.is_some() {
            return result;
        }
    }

    None
}

fn is_supported_system_python_version(version_text: &str) -> bool {
    match parse_python_major_minor(version_text) {
        Some((major, minor)) => SUPPORTED_SYSTEM_PYTHON.contains(&(major, minor)),
        None => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallStage {
    Idle,
    Checking,
    DownloadingPython,
    ExtractingPython,
    InstallingPip,
    InstallingDownloadDependencies,
    InstallingDependencies,
    Complete,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub stage: InstallStage,
    pub percent: f64,
    pub message: String,
    pub error: Option<String>,
}

impl Default for InstallProgress {
    fn default() -> Self {
        Self {
            stage: InstallStage::Idle,
            percent: 0.0,
            message: String::new(),
            error: None,
        }
    }
}

pub struct PythonInstaller {
    app: AppHandle,
    progress: Mutex<InstallProgress>,
}

impl PythonInstaller {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            progress: Mutex::new(InstallProgress::default()),
        }
    }

    fn emit_progress(&self, stage: InstallStage, percent: f64, message: &str) {
        let progress = InstallProgress {
            stage: stage.clone(),
            percent,
            message: message.to_string(),
            error: None,
        };
        *self.progress.lock().unwrap() = progress.clone();
        let _ = self.app.emit("python-install-progress", &progress);
        eprintln!(
            "[PYTHON INSTALLER] {}: {}% - {}",
            format!("{:?}", stage),
            percent as i32,
            message
        );
    }

    #[allow(dead_code)]
    fn emit_error(&self, error: &str) {
        let mut current = self.progress.lock().unwrap();
        let progress = InstallProgress {
            stage: InstallStage::Error,
            percent: current.percent,
            message: current.message.clone(),
            error: Some(error.to_string()),
        };
        *current = progress.clone();
        let _ = self.app.emit("python-install-progress", &progress);
        eprintln!("[PYTHON INSTALLER ERROR] {}", error);
    }

    pub fn get_progress(&self) -> InstallProgress {
        self.progress.lock().unwrap().clone()
    }

    /// Get the Python installation directory
    fn get_python_dir(&self) -> PathBuf {
        let app_data = self.app.path().app_data_dir().unwrap_or_else(|_| {
            self.app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
        });
        app_data.join("ai-engine").join("python")
    }

    /// Get the Python executable path
    fn get_python_exe(&self) -> PathBuf {
        let python_dir = self.get_python_dir();
        #[cfg(target_os = "windows")]
        {
            python_dir.join("python.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            python_dir.join("bin").join("python")
        }
    }

    async fn python_has_module(&self, module: &str) -> bool {
        let python_exe = self.get_python_exe();
        if !python_exe.exists() {
            return false;
        }

        let code = format!(
            "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('{}') else 1)",
            module
        );

        match create_hidden_command(&python_exe)
            .arg("-c")
            .arg(code)
            .output()
            .await
        {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    #[allow(dead_code)]
    async fn python_code_succeeds(&self, code: &str) -> bool {
        let python_exe = self.get_python_exe();
        if !python_exe.exists() {
            return false;
        }

        match create_hidden_command(&python_exe)
            .arg("-c")
            .arg(code)
            .output()
            .await
        {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    fn enable_embeddable_site(&self, python_dir: &Path) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let read_dir = std::fs::read_dir(python_dir)
                .map_err(|e| format!("Failed to read Python directory: {}", e))?;

            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("_pth") {
                    continue;
                }

                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read {:?}: {}", path, e))?;

                if content.contains("import site") && !content.contains("#import site") {
                    return Ok(());
                }

                let updated = if content.contains("#import site") {
                    content.replace("#import site", "import site")
                } else {
                    format!("{}\nimport site\n", content.trim_end())
                };

                std::fs::write(&path, updated)
                    .map_err(|e| format!("Failed to update {:?}: {}", path, e))?;
                eprintln!("[PYTHON INSTALLER] Enabled import site in {:?}", path);
                return Ok(());
            }
        }

        Ok(())
    }

    /// Check if Python is already installed
    pub fn is_python_installed(&self) -> bool {
        self.get_python_exe().exists()
    }

    /// Check if system Python is available and has torch
    pub async fn check_system_python(&self) -> Result<Option<PathBuf>, String> {
        self.emit_progress(InstallStage::Checking, 0.0, "Проверка системы...");

        // Try to find system Python
        let python_candidates = vec!["python", "python3", "python12", "py"];

        for python_cmd in python_candidates {
            let result = create_hidden_command(python_cmd)
                .arg("--version")
                .output()
                .await;

            if let Ok(output) = result {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let version_str = format!("{} {}", stdout.trim(), stderr.trim());
                    eprintln!(
                        "[PYTHON INSTALLER] Found system Python ({}): {}",
                        python_cmd, version_str
                    );

                    if !is_supported_system_python_version(&version_str) {
                        eprintln!(
                            "[PYTHON INSTALLER] System Python {} is unsupported, skipping",
                            python_cmd
                        );
                        continue;
                    }

                    return Ok(Some(PathBuf::from(python_cmd)));
                }
            }
        }

        Ok(None)
    }

    /// Install Python using embeddable distribution
    pub async fn install_python(&self) -> Result<(), String> {
        let python_dir = self.get_python_dir();

        // Check if already installed
        if self.get_python_exe().exists() {
            self.emit_progress(
                InstallStage::Checking,
                35.0,
                "Checking existing Python installation...",
            );
            self.enable_embeddable_site(&python_dir)?;

            if !self.python_has_module("pip").await {
                self.emit_progress(
                    InstallStage::InstallingPip,
                    50.0,
                    "Repairing Python installation (pip missing)...",
                );
                self.install_pip(&python_dir).await?;
            }

            if !self.python_has_module("pip").await {
                return Err("Python is installed, but pip is unavailable after repair".to_string());
            }

            self.install_download_dependencies(&self.get_python_exe())
                .await?;

            self.install_dependencies(&python_dir).await?;
            self.emit_progress(InstallStage::Complete, 100.0, "Python environment is ready");
            return Ok(());
        }

        // Check system Python first
        if let Ok(Some(system_python)) = self.check_system_python().await {
            self.install_download_dependencies(&system_python).await?;
            self.install_dependencies_for(&system_python, &python_dir)
                .await?;
            self.emit_progress(
                InstallStage::Complete,
                100.0,
                "Используется системный Python",
            );
            return Ok(());
        }

        // Install embeddable Python
        self.install_embeddable_python(&python_dir).await?;

        // Install pip
        self.install_pip(&python_dir).await?;

        // Install download dependencies
        self.install_download_dependencies(&self.get_python_exe())
            .await?;

        // Install dependencies
        self.install_dependencies_for(&self.get_python_exe(), &python_dir)
            .await?;

        self.emit_progress(InstallStage::Complete, 100.0, "Установка завершена");
        Ok(())
    }

    async fn install_embeddable_python(&self, python_dir: &PathBuf) -> Result<(), String> {
        self.emit_progress(
            InstallStage::DownloadingPython,
            10.0,
            "Скачивание Python...",
        );

        // Determine URL based on platform
        let url = if cfg!(target_os = "windows") {
            format!(
                "https://www.python.org/ftp/python/{}/python-{}-embed-amd64.zip",
                PYTHON_VERSION, PYTHON_VERSION
            )
        } else if cfg!(target_os = "macos") {
            // For macOS, we'll use system Python or Homebrew
            // Embeddable macOS is not commonly available
            return Err("macOS требует установки Python через Homebrew или системы".to_string());
        } else {
            return Err(
                "Linux требует установки Python через системный пакетный менеджер".to_string(),
            );
        };

        eprintln!("[PYTHON INSTALLER] Downloading from: {}", url);

        // Download the archive
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to download: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        let total_size = response.content_length().unwrap_or(0);
        eprintln!(
            "[PYTHON INSTALLER] Download size: {} MB",
            total_size / 1024 / 1024
        );

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        // Create directory
        std::fs::create_dir_all(python_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        // Save archive
        let archive_path = python_dir.join("python.zip");
        std::fs::write(&archive_path, &bytes)
            .map_err(|e| format!("Failed to save archive: {}", e))?;

        self.emit_progress(InstallStage::ExtractingPython, 30.0, "Распаковка Python...");

        // Extract zip
        let zip_file = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Failed to open archive: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {}", e))?;
            let outpath = python_dir.join(file.mangled_name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                if let Some(parent) = outpath.parent() {
                    if !parent.exists() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| format!("Failed to create parent: {}", e))?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }

        // Clean up archive
        std::fs::remove_file(archive_path)
            .map_err(|e| format!("Failed to remove archive: {}", e))?;

        self.enable_embeddable_site(python_dir)?;
        self.emit_progress(InstallStage::InstallingPip, 40.0, "Python установлен");

        Ok(())
    }

    async fn install_pip(&self, python_dir: &PathBuf) -> Result<(), String> {
        self.emit_progress(InstallStage::InstallingPip, 50.0, "Установка pip...");

        let python_exe = self.get_python_exe();
        if !python_exe.exists() {
            return Err("Python executable not found".to_string());
        }

        // Download get-pip.py
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client
            .get(GET_PIP_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to download get-pip.py: {}", e))?;

        let get_pip_content = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read get-pip.py: {}", e))?;

        // Save get-pip.py
        let get_pip_path = python_dir.join("get-pip.py");
        std::fs::write(&get_pip_path, get_pip_content)
            .map_err(|e| format!("Failed to save get-pip.py: {}", e))?;

        // Run get-pip.py
        let output = create_hidden_command(&python_exe)
            .arg(get_pip_path.to_str().unwrap())
            .arg("--no-warn-script-location")
            .output()
            .await
            .map_err(|e| format!("Failed to run get-pip.py: {}", e))?;

        // Clean up
        let _ = std::fs::remove_file(get_pip_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[PYTHON INSTALLER] get-pip.py stderr: {}", stderr);
            eprintln!("[PYTHON INSTALLER] get-pip.py failed, falling back to ensurepip");
            let ensure_output = create_hidden_command(&python_exe)
                .arg("-m")
                .arg("ensurepip")
                .arg("--upgrade")
                .output()
                .await
                .map_err(|e| format!("Failed to run ensurepip: {}", e))?;

            if !ensure_output.status.success() {
                let ensure_stderr = String::from_utf8_lossy(&ensure_output.stderr);
                eprintln!("[PYTHON INSTALLER] ensurepip stderr: {}", ensure_stderr);
                return Err(format!(
                    "Failed to install pip (get-pip + ensurepip). get-pip: {} | ensurepip: {}",
                    stderr.trim(),
                    ensure_stderr.trim()
                ));
            }
        }
        if !self.python_has_module("pip").await {
            return Err(
                "pip installation completed, but module 'pip' is still unavailable".to_string(),
            );
        }

        self.emit_progress(InstallStage::InstallingPip, 60.0, "pip установлен");
        Ok(())
    }

    /// Install dependencies required for model downloads (requests, tenacity, huggingface_hub).
    /// These are always needed even if transcription is handled by Rust.
    async fn install_download_dependencies(&self, python_exe: &Path) -> Result<(), String> {
        self.emit_progress(
            InstallStage::InstallingDownloadDependencies,
            82.0,
            "Installing download dependencies...",
        );

        let packages = [
            "requests==2.31.0",
            "tenacity==8.5.0",
            "huggingface_hub==0.23.4",
        ];

        for package in packages {
            let output = create_hidden_command(python_exe)
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg(package)
                .arg("--no-warn-script-location")
                .output()
                .await
                .map_err(|e| format!("Failed to install {}: {}", package, e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[PYTHON INSTALLER] {} install warning: {}", package, stderr);
            }
        }

        self.emit_progress(
            InstallStage::InstallingDownloadDependencies,
            85.0,
            "Download dependencies ready",
        );
        Ok(())
    }

    async fn install_dependencies(&self, python_dir: &PathBuf) -> Result<(), String> {
        self.install_dependencies_for(&self.get_python_exe(), python_dir)
            .await
    }

    /// Install ai-engine dependencies using an explicit Python executable.
    /// Separating the exe from the discovery logic allows us to install into
    /// system Python environments (where `self.get_python_exe()` points nowhere).
    async fn install_dependencies_for(
        &self,
        python_exe: &Path,
        python_dir: &PathBuf,
    ) -> Result<(), String> {
        self.emit_progress(
            InstallStage::InstallingDependencies,
            85.0,
            "Installing dependencies...",
        );

        if !python_exe.exists() && python_exe.components().count() > 1 {
            return Err(format!("Python executable not found: {:?}", python_exe));
        }

        // For embeddable Python, verify pip is present before proceeding
        if python_exe == self.get_python_exe() && !self.python_has_module("pip").await {
            self.emit_progress(
                InstallStage::InstallingPip,
                84.0,
                "pip missing before dependency install, repairing...",
            );
            self.install_pip(&self.get_python_dir()).await?;
        }

        let ai_engine_dir = python_dir
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| python_dir.clone());

        let mut requirements_candidates = vec![ai_engine_dir.join("requirements.txt")];
        if let Ok(resource_dir) = self.app.path().resource_dir() {
            requirements_candidates.push(resource_dir.join("ai-engine").join("requirements.txt"));
        }
        requirements_candidates.push(PathBuf::from("../ai-engine/requirements.txt"));
        requirements_candidates.push(PathBuf::from("ai-engine/requirements.txt"));

        let requirements_path = requirements_candidates.into_iter().find(|p| p.exists());

        let Some(requirements_path) = requirements_path else {
            eprintln!("[PYTHON INSTALLER] requirements.txt not found in known locations");
            return Ok(());
        };

        self.emit_progress(
            InstallStage::InstallingDependencies,
            90.0,
            "Installing Python dependencies...",
        );

        let output = create_hidden_command(&python_exe)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("-r")
            .arg(requirements_path.to_str().unwrap_or("requirements.txt"))
            .arg("--no-warn-script-location")
            .output()
            .await
            .map_err(|e| format!("Failed to install dependencies: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!(
                "[PYTHON INSTALLER] Dependencies install warning: {}",
                stderr
            );
        }

        self.emit_progress(
            InstallStage::InstallingDependencies,
            95.0,
            "Dependencies installed",
        );
        Ok(())
    }
}

/// Check if Python is available (system or installed)
#[tauri::command]
pub async fn check_python_installed(app: AppHandle) -> Result<bool, String> {
    let installer = PythonInstaller::new(app);

    // Check for embeddable Python
    if installer.is_python_installed() {
        return Ok(true);
    }

    // Check for system Python
    if let Ok(Some(_)) = installer.check_system_python().await {
        return Ok(true);
    }

    Ok(false)
}

/// Get current installation progress
#[tauri::command]
pub fn get_python_install_progress(_app: AppHandle) -> Result<InstallProgress, String> {
    // This would need state management for real progress tracking
    // For now, return default
    Ok(InstallProgress::default())
}

/// Install Python (full installation)
#[tauri::command]
pub async fn install_python_full(app: AppHandle) -> Result<(), String> {
    let installer = PythonInstaller::new(app);
    installer.install_python().await
}

/// Cancel ongoing installation (placeholder)
#[tauri::command]
pub fn cancel_python_install() -> Result<(), String> {
    // In a real implementation, this would cancel the ongoing process
    // For now, just return ok
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{should_install_or_upgrade_torch, TorchInstallTarget};

    #[test]
    fn cuda_target_upgrades_cpu_only_torch() {
        let should_upgrade = should_install_or_upgrade_torch(TorchInstallTarget::Cuda, true, false);

        assert!(should_upgrade);
    }

    #[test]
    fn cuda_target_skips_upgrade_when_cuda_build_present() {
        let should_upgrade = should_install_or_upgrade_torch(TorchInstallTarget::Cuda, true, true);

        assert!(!should_upgrade);
    }

    #[test]
    fn cpu_target_keeps_existing_torch() {
        let should_upgrade = should_install_or_upgrade_torch(TorchInstallTarget::Cpu, true, false);

        assert!(!should_upgrade);
    }

    // parse_python_major_minor: `?` must NOT exit the loop on non-numeric tokens
    #[test]
    fn parse_python_version_from_command_output() {
        // Typical `python --version` output (Python writes to stdout or stderr)
        assert_eq!(
            super::parse_python_major_minor("Python 3.12.10"),
            Some((3, 12))
        );
        assert_eq!(
            super::parse_python_major_minor("Python 3.10.14"),
            Some((3, 10))
        );
        // Some systems include trailing whitespace or carriage return
        assert_eq!(
            super::parse_python_major_minor("Python 3.11.9\r\n"),
            Some((3, 11))
        );
        // Combined stdout+stderr string (both may be empty)
        assert_eq!(
            super::parse_python_major_minor("Python 3.12.10 "),
            Some((3, 12))
        );
    }

    #[test]
    fn parse_python_version_rejects_garbage() {
        assert_eq!(super::parse_python_major_minor(""), None);
        assert_eq!(super::parse_python_major_minor("no version here"), None);
        // "0.0" is explicitly rejected
        assert_eq!(super::parse_python_major_minor("0.0"), None);
    }

    #[test]
    fn supported_system_python_accepts_valid_versions() {
        assert!(super::is_supported_system_python_version("Python 3.10.14"));
        assert!(super::is_supported_system_python_version("Python 3.11.9"));
        assert!(super::is_supported_system_python_version("Python 3.12.10"));
    }

    #[test]
    fn supported_system_python_rejects_unsupported_versions() {
        assert!(!super::is_supported_system_python_version("Python 3.9.18"));
        assert!(!super::is_supported_system_python_version("Python 3.13.0"));
        assert!(!super::is_supported_system_python_version("Python 2.7.18"));
        assert!(!super::is_supported_system_python_version(""));
    }
}
