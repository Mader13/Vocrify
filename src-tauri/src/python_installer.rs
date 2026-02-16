//! Python Installer Module
//!
//! This module handles automatic Python installation for the application.
//! It downloads embeddable Python, installs pip, PyTorch, and dependencies.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;
use std::process::Command as StdCommand;

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

const PYTHON_VERSION: &str = "3.12.10";
const GET_PIP_URL: &str = "https://bootstrap.pypa.io/get-pip.py";
const SUPPORTED_SYSTEM_PYTHON: &[(u32, u32)] = &[(3, 10), (3, 11), (3, 12)];

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TorchInstallTarget {
    Cuda,
    Mps,
    Cpu,
}

impl TorchInstallTarget {
    fn label(self) -> &'static str {
        match self {
            TorchInstallTarget::Cuda => "CUDA",
            TorchInstallTarget::Mps => "MPS",
            TorchInstallTarget::Cpu => "CPU",
        }
    }
}

#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn create_hidden_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> Command {
    let mut cmd = Command::new(program.as_ref());
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
pub fn create_hidden_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> Command {
    Command::new(program.as_ref())
}

#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn create_hidden_std_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> StdCommand {
    let mut cmd = StdCommand::new(program.as_ref());
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
pub fn create_hidden_std_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> StdCommand {
    StdCommand::new(program.as_ref())
}

fn parse_python_major_minor(version_text: &str) -> Option<(u32, u32)> {
    for token in version_text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        let mut parts = cleaned.split('.');
        let major = parts.next()?.parse::<u32>().ok()?;
        let minor = parts.next()?.parse::<u32>().ok()?;
        return Some((major, minor));
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
    InstallingPytorch,
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
    progress: InstallProgress,
}

impl PythonInstaller {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            progress: InstallProgress::default(),
        }
    }

    fn emit_progress(&mut self, stage: InstallStage, percent: f64, message: &str) {
        self.progress = InstallProgress {
            stage: stage.clone(),
            percent,
            message: message.to_string(),
            error: None,
        };
        let _ = self.app.emit("python-install-progress", &self.progress);
        eprintln!("[PYTHON INSTALLER] {}: {}% - {}", 
            format!("{:?}", stage), 
            percent as i32, 
            message
        );
    }

    #[allow(dead_code)]
    fn emit_error(&mut self, error: &str) {
        self.progress = InstallProgress {
            stage: InstallStage::Error,
            percent: self.progress.percent,
            message: self.progress.message.clone(),
            error: Some(error.to_string()),
        };
        let _ = self.app.emit("python-install-progress", &self.progress);
        eprintln!("[PYTHON INSTALLER ERROR] {}", error);
    }

    pub fn get_progress(&self) -> InstallProgress {
        self.progress.clone()
    }

    /// Get the Python installation directory
    fn get_python_dir(&self) -> PathBuf {
        let app_data = self.app.path().app_data_dir()
            .unwrap_or_else(|_| {
                self.app.path().resource_dir()
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

    async fn has_nvidia_gpu(&self) -> bool {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            let output = create_hidden_command("nvidia-smi")
                .arg("--query-gpu=name")
                .arg("--format=csv,noheader")
                .output()
                .await;

            if let Ok(output) = output {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    return !stdout.trim().is_empty();
                }
            }
        }

        false
    }

    async fn detect_torch_install_target(&self) -> TorchInstallTarget {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return TorchInstallTarget::Mps;
        }

        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            if self.has_nvidia_gpu().await {
                return TorchInstallTarget::Cuda;
            }
        }

        TorchInstallTarget::Cpu
    }

    fn torch_install_args(&self, target: TorchInstallTarget) -> Vec<String> {
        let mut args = vec![
            "install".to_string(),
            "--upgrade".to_string(),
            "--force-reinstall".to_string(),
            "--no-cache-dir".to_string(),
            "--no-warn-script-location".to_string(),
            "torch".to_string(),
            "torchvision".to_string(),
            "torchaudio".to_string(),
        ];

        if target == TorchInstallTarget::Cuda {
            args.push("--index-url".to_string());
            args.push("https://download.pytorch.org/whl/cu121".to_string());
            args.push("--extra-index-url".to_string());
            args.push("https://pypi.org/simple".to_string());
        }

        args
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
    pub async fn check_system_python(&mut self) -> Result<Option<PathBuf>, String> {
        self.emit_progress(InstallStage::Checking, 0.0, "Проверка системы...");

        // Try to find system Python
        let python_candidates = vec![
            "python",
            "python3",
            "python12",
            "py",
        ];

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
                        python_cmd,
                        version_str
                    );

                    if !is_supported_system_python_version(&version_str) {
                        eprintln!(
                            "[PYTHON INSTALLER] System Python {} is unsupported, skipping",
                            python_cmd
                        );
                        continue;
                    }

                    // Check if torch is available
                    let torch_check = create_hidden_command(python_cmd)
                        .arg("-c")
                        .arg("import torch; print(torch.__version__)")
                        .output()
                        .await;

                    if let Ok(torch_output) = torch_check {
                        if torch_output.status.success() {
                            let torch_version = String::from_utf8_lossy(&torch_output.stdout);
                            eprintln!("[PYTHON INSTALLER] System Python has torch: {}", torch_version);
                            return Ok(Some(PathBuf::from(python_cmd)));
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// Install Python using embeddable distribution
    pub async fn install_python(&mut self) -> Result<(), String> {
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
                return Err(
                    "Python is installed, but pip is unavailable after repair".to_string(),
                );
            }

            if !self.python_has_module("torch").await {
                self.install_pytorch(&python_dir).await?;
            }

            self.install_dependencies(&python_dir).await?;
            self.emit_progress(InstallStage::Complete, 100.0, "Python environment is ready");
            return Ok(());
        }

        // Check system Python first
        if let Ok(Some(_system_python)) = self.check_system_python().await {
            self.emit_progress(InstallStage::Complete, 100.0, 
                &format!("Используется системный Python"));
            return Ok(());
        }

        // Install embeddable Python
        self.install_embeddable_python(&python_dir).await?;

        // Install pip
        self.install_pip(&python_dir).await?;

        // Install PyTorch
        self.install_pytorch(&python_dir).await?;

        // Install dependencies
        self.install_dependencies(&python_dir).await?;

        self.emit_progress(InstallStage::Complete, 100.0, "Установка завершена");
        Ok(())
    }

    async fn install_embeddable_python(&mut self, python_dir: &PathBuf) -> Result<(), String> {
        self.emit_progress(InstallStage::DownloadingPython, 10.0, "Скачивание Python...");

        // Determine URL based on platform
        let url = if cfg!(target_os = "windows") {
            format!("https://www.python.org/ftp/python/{}/python-{}-embed-amd64.zip", 
                PYTHON_VERSION, PYTHON_VERSION)
        } else if cfg!(target_os = "macos") {
            // For macOS, we'll use system Python or Homebrew
            // Embeddable macOS is not commonly available
            return Err("macOS требует установки Python через Homebrew или системы".to_string());
        } else {
            return Err("Linux требует установки Python через системный пакетный менеджер".to_string());
        };

        eprintln!("[PYTHON INSTALLER] Downloading from: {}", url);

        // Download the archive
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to download: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        eprintln!("[PYTHON INSTALLER] Download size: {} MB", total_size / 1024 / 1024);

        let bytes = response.bytes()
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
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read zip: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
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

    async fn install_pip(&mut self, python_dir: &PathBuf) -> Result<(), String> {
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

        let response = client.get(GET_PIP_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to download get-pip.py: {}", e))?;

        let get_pip_content = response.bytes()
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
                eprintln!(
                    "[PYTHON INSTALLER] ensurepip stderr: {}",
                    ensure_stderr
                );
                return Err(format!(
                    "Failed to install pip (get-pip + ensurepip). get-pip: {} | ensurepip: {}",
                    stderr.trim(),
                    ensure_stderr.trim()
                ));
            }
        }
        if !self.python_has_module("pip").await {
            return Err("pip installation completed, but module 'pip' is still unavailable".to_string());
        }

        self.emit_progress(InstallStage::InstallingPip, 60.0, "pip установлен");
        Ok(())
    }

    async fn install_pytorch(&mut self, _python_dir: &PathBuf) -> Result<(), String> {
        self.emit_progress(InstallStage::InstallingPytorch, 65.0, "Installing PyTorch...");

        let python_exe = self.get_python_exe();
        if !self.python_has_module("pip").await {
            self.emit_progress(
                InstallStage::InstallingPip,
                62.0,
                "pip missing before PyTorch install, repairing...",
            );
            self.install_pip(&self.get_python_dir()).await?;
        }

        // First, upgrade pip
        let output = create_hidden_command(&python_exe)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--upgrade")
            .arg("pip")
            .arg("--no-warn-script-location")
            .output()
            .await
            .map_err(|e| format!("Failed to upgrade pip: {}", e))?;

        if !output.status.success() {
            eprintln!(
                "[PYTHON INSTALLER] pip upgrade warning: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        // Flexible target selection:
        // - NVIDIA GPU => CUDA wheels
        // - Apple Silicon => standard wheels (MPS runtime)
        // - AMD/Intel/no GPU => CPU wheels
        let target = self.detect_torch_install_target().await;
        let target_message = format!(
            "Installing PyTorch for {} (this can take a while)...",
            target.label()
        );
        self.emit_progress(InstallStage::InstallingPytorch, 70.0, &target_message);

        let mut args = self.torch_install_args(target);
        let mut output = create_hidden_command(&python_exe)
            .arg("-m")
            .arg("pip")
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Failed to install PyTorch: {}", e))?;

        let mut first_error: Option<String> = None;
        if !output.status.success() && target == TorchInstallTarget::Cuda {
            let cuda_stderr = String::from_utf8_lossy(&output.stderr).to_string();
            first_error = Some(cuda_stderr.clone());
            eprintln!(
                "[PYTHON INSTALLER] CUDA PyTorch install failed, falling back to CPU: {}",
                cuda_stderr
            );

            self.emit_progress(
                InstallStage::InstallingPytorch,
                74.0,
                "CUDA install failed, falling back to CPU build...",
            );

            args = self.torch_install_args(TorchInstallTarget::Cpu);
            output = create_hidden_command(&python_exe)
                .arg("-m")
                .arg("pip")
                .args(&args)
                .output()
                .await
                .map_err(|e| format!("Failed to install CPU PyTorch fallback: {}", e))?;
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[PYTHON INSTALLER] PyTorch install stderr: {}", stderr);
            if let Some(first) = first_error {
                return Err(format!(
                    "Failed to install PyTorch (CUDA attempt + fallback). CUDA error: {} | Final error: {}",
                    first.trim(),
                    stderr.trim()
                ));
            }
            return Err(format!("Failed to install PyTorch: {}", stderr));
        }

        let cuda_available = self
            .python_code_succeeds("import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)")
            .await;
        let mps_available = self
            .python_code_succeeds(
                "import torch,sys; sys.exit(0 if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 1)",
            )
            .await;

        let effective_backend = if cuda_available {
            "CUDA"
        } else if mps_available {
            "MPS"
        } else {
            "CPU"
        };

        let done_message = format!("PyTorch installed ({})", effective_backend);
        self.emit_progress(InstallStage::InstallingPytorch, 80.0, &done_message);
        Ok(())
    }

    async fn install_dependencies(&mut self, python_dir: &PathBuf) -> Result<(), String> {
        self.emit_progress(InstallStage::InstallingDependencies, 85.0, "Installing dependencies...");

        let python_exe = self.get_python_exe();
        if !self.python_has_module("pip").await {
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
            eprintln!("[PYTHON INSTALLER] Dependencies install warning: {}", stderr);
        }

        self.emit_progress(InstallStage::InstallingDependencies, 95.0, "Dependencies installed");
        Ok(())
    }
}

/// Check if Python is available (system or installed)
#[tauri::command]
pub async fn check_python_installed(app: AppHandle) -> Result<bool, String> {
    let mut installer = PythonInstaller::new(app);
    
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
    let mut installer = PythonInstaller::new(app);
    installer.install_python().await
}

/// Cancel ongoing installation (placeholder)
#[tauri::command]
pub fn cancel_python_install() -> Result<(), String> {
    // In a real implementation, this would cancel the ongoing process
    // For now, just return ok
    Ok(())
}

