//! Python Installer Module
//!
//! This module handles automatic Python installation for the application.
//! It downloads embeddable Python, installs pip, PyTorch, and dependencies.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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

fn should_install_or_upgrade_torch(
    target: TorchInstallTarget,
    torch_installed: bool,
    torch_has_cuda_build: bool,
) -> bool {
    if !torch_installed {
        return true;
    }

    matches!(target, TorchInstallTarget::Cuda) && !torch_has_cuda_build
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
        eprintln!("[PYTHON INSTALLER] {}: {}% - {}",
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

    async fn python_torch_has_cuda_build(&self) -> bool {
        self.python_code_succeeds(
            "import torch,sys; sys.exit(0 if getattr(getattr(torch,'version',None),'cuda',None) else 1)",
        )
        .await
    }

    async fn system_python_torch_has_cuda_build(&self, python_cmd: &str) -> bool {
        match create_hidden_command(python_cmd)
            .arg("-c")
            .arg("import torch,sys; sys.exit(0 if getattr(getattr(torch,'version',None),'cuda',None) else 1)")
            .output()
            .await
        {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    fn nvidia_smi_candidates() -> Vec<PathBuf> {
        let mut candidates = vec![PathBuf::from("nvidia-smi")];

        #[cfg(target_os = "windows")]
        {
            // Check NVIDIA_NVSMI_PATH env var first (set by some NVIDIA driver installs)
            if let Ok(nvsmi_path) = std::env::var("NVIDIA_NVSMI_PATH") {
                candidates.push(PathBuf::from(&nvsmi_path).join("nvidia-smi.exe"));
                candidates.push(PathBuf::from(nvsmi_path));
            }

            if let Ok(program_files) = std::env::var("ProgramFiles") {
                candidates.push(
                    PathBuf::from(&program_files)
                        .join("NVIDIA Corporation")
                        .join("NVSMI")
                        .join("nvidia-smi.exe"),
                );
            }

            if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
                candidates.push(
                    PathBuf::from(program_files_x86)
                        .join("NVIDIA Corporation")
                        .join("NVSMI")
                        .join("nvidia-smi.exe"),
                );
            }

            candidates.push(
                PathBuf::from("C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"),
            );
            // Modern NVIDIA drivers install nvidia-smi.exe directly to System32
            candidates.push(PathBuf::from("C:\\Windows\\System32\\nvidia-smi.exe"));
            // Some driver versions use SysWOW64
            candidates.push(PathBuf::from("C:\\Windows\\SysWOW64\\nvidia-smi.exe"));
        }

        candidates
    }

    /// Check for nvcuda.dll — present on any system with NVIDIA CUDA-capable driver
    #[cfg(target_os = "windows")]
    fn has_nvcuda_dll() -> bool {
        let candidates = [
            "C:\\Windows\\System32\\nvcuda.dll",
            "C:\\Windows\\SysWOW64\\nvcuda.dll",
        ];
        candidates.iter().any(|p| std::path::Path::new(p).exists())
    }

    /// PowerShell-based GPU detection (works on Windows 11 where wmic is deprecated)
    #[cfg(target_os = "windows")]
    async fn has_nvidia_gpu_via_powershell(&self) -> bool {
        let script = "Get-WmiObject Win32_VideoController | \
            Select-Object -ExpandProperty Name | \
            Where-Object { $_ -match 'NVIDIA' }";

        let output = create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .await;

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if !stdout.trim().is_empty() {
                    eprintln!(
                        "[PYTHON INSTALLER] NVIDIA GPU detected via PowerShell: {}",
                        stdout.trim()
                    );
                    return true;
                }
            }
        }

        false
    }

    async fn has_nvidia_gpu(&self) -> bool {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            for candidate in Self::nvidia_smi_candidates() {
                let output = create_hidden_command(&candidate)
                    .arg("--query-gpu=name")
                    .arg("--format=csv,noheader")
                    .output()
                    .await;

                if let Ok(output) = output {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if !stdout.trim().is_empty() {
                            eprintln!(
                                "[PYTHON INSTALLER] NVIDIA GPU detected via {:?}",
                                candidate
                            );
                            return true;
                        }
                    }
                }
            }

            // nvcuda.dll check — lightweight, no process spawn (Windows only)
            #[cfg(target_os = "windows")]
            if Self::has_nvcuda_dll() {
                eprintln!("[PYTHON INSTALLER] NVIDIA GPU detected via nvcuda.dll presence");
                return true;
            }

            // wmic fallback — deprecated in Windows 11 22H2+, try anyway
            if let Ok(output) = create_hidden_command("wmic")
                .arg("path")
                .arg("win32_VideoController")
                .arg("get")
                .arg("name")
                .output()
                .await
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let lowered = stdout.to_lowercase();
                    if lowered.contains("nvidia") {
                        eprintln!("[PYTHON INSTALLER] NVIDIA GPU detected via WMIC fallback");
                        return true;
                    }
                }
            }

            // PowerShell fallback — always available on Windows 10/11 (Windows only)
            #[cfg(target_os = "windows")]
            if self.has_nvidia_gpu_via_powershell().await {
                return true;
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

    /// Build pip install args for PyTorch.
    ///
    /// `is_upgrade`: when true (replacing CPU→CUDA), adds `--force-reinstall` so pip
    /// actually replaces the existing wheels. For fresh installs this flag is omitted
    /// to avoid the overhead of redownloading when nothing is installed yet.
    ///
    /// NOTE: for CUDA we only pass `--index-url` (PyTorch WHL index already contains
    /// torchvision/torchaudio CUDA builds). Adding `--extra-index-url pypi.org/simple`
    /// is unnecessary and can cause pip to pick CPU wheels from PyPI over CUDA ones.
    fn torch_install_args(&self, target: TorchInstallTarget, is_upgrade: bool) -> Vec<String> {
        let mut args = vec![
            "install".to_string(),
            "--no-warn-script-location".to_string(),
        ];

        if is_upgrade {
            // Force pip to replace existing CPU wheels with CUDA wheels.
            args.push("--upgrade".to_string());
            args.push("--force-reinstall".to_string());
            args.push("--no-cache-dir".to_string());
        }

        args.extend(["torch".to_string(), "torchvision".to_string(), "torchaudio".to_string()]);

        if target == TorchInstallTarget::Cuda {
            args.push("--index-url".to_string());
            args.push("https://download.pytorch.org/whl/cu121".to_string());
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
    pub async fn check_system_python(&self) -> Result<Option<PathBuf>, String> {
        self.emit_progress(InstallStage::Checking, 0.0, "Проверка системы...");
        let target = self.detect_torch_install_target().await;

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
                            if matches!(target, TorchInstallTarget::Cuda)
                                && !self.system_python_torch_has_cuda_build(python_cmd).await
                            {
                                eprintln!(
                                    "[PYTHON INSTALLER] System Python torch is CPU-only, skipping for CUDA target: {}",
                                    python_cmd
                                );
                                continue;
                            }

                            eprintln!(
                                "[PYTHON INSTALLER] System Python has torch: {}",
                                torch_version
                            );
                            return Ok(Some(PathBuf::from(python_cmd)));
                        }
                    }
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
                return Err(
                    "Python is installed, but pip is unavailable after repair".to_string(),
                );
            }

            let target = self.detect_torch_install_target().await;
            let torch_installed = self.python_has_module("torch").await;
            let torch_has_cuda_build = if torch_installed {
                self.python_torch_has_cuda_build().await
            } else {
                false
            };

            if should_install_or_upgrade_torch(target, torch_installed, torch_has_cuda_build) {
                // is_upgrade = torch was already installed but wrong build (CPU→CUDA)
                let is_upgrade = torch_installed;
                if is_upgrade {
                    self.emit_progress(
                        InstallStage::InstallingPytorch,
                        64.0,
                        "Detected CPU-only PyTorch on NVIDIA system, upgrading to CUDA build...",
                    );
                }
                self.install_pytorch(&python_dir, is_upgrade).await?;
            }

            self.install_dependencies(&python_dir).await?;
            self.emit_progress(InstallStage::Complete, 100.0, "Python environment is ready");
            return Ok(());
        }

        // Check system Python first
        if let Ok(Some(system_python)) = self.check_system_python().await {
            // Still install ai-engine dependencies into the system Python env
            self.install_dependencies_for(&system_python, &python_dir).await?;
            self.emit_progress(InstallStage::Complete, 100.0, "Используется системный Python");
            return Ok(());
        }

        // Install embeddable Python
        self.install_embeddable_python(&python_dir).await?;

        // Install pip
        self.install_pip(&python_dir).await?;

        // Install PyTorch (fresh install — no force-reinstall needed)
        self.install_pytorch(&python_dir, false).await?;

        // Install dependencies
        self.install_dependencies_for(&self.get_python_exe(), &python_dir).await?;

        self.emit_progress(InstallStage::Complete, 100.0, "Установка завершена");
        Ok(())
    }

    async fn install_embeddable_python(&self, python_dir: &PathBuf) -> Result<(), String> {
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

    async fn install_pytorch(&self, _python_dir: &PathBuf, is_upgrade: bool) -> Result<(), String> {
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

        let mut args = self.torch_install_args(target, is_upgrade);
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

            args = self.torch_install_args(TorchInstallTarget::Cpu, is_upgrade);
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

    async fn install_dependencies(&self, python_dir: &PathBuf) -> Result<(), String> {
        self.install_dependencies_for(&self.get_python_exe(), python_dir).await
    }

    /// Install ai-engine dependencies using an explicit Python executable.
    /// Separating the exe from the discovery logic allows us to install into
    /// system Python environments (where `self.get_python_exe()` points nowhere).
    async fn install_dependencies_for(
        &self,
        python_exe: &Path,
        python_dir: &PathBuf,
    ) -> Result<(), String> {
        self.emit_progress(InstallStage::InstallingDependencies, 85.0, "Installing dependencies...");

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
            eprintln!("[PYTHON INSTALLER] Dependencies install warning: {}", stderr);
        }

        self.emit_progress(InstallStage::InstallingDependencies, 95.0, "Dependencies installed");
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
        let should_upgrade = should_install_or_upgrade_torch(
            TorchInstallTarget::Cuda,
            true,
            false,
        );

        assert!(should_upgrade);
    }

    #[test]
    fn cuda_target_skips_upgrade_when_cuda_build_present() {
        let should_upgrade = should_install_or_upgrade_torch(
            TorchInstallTarget::Cuda,
            true,
            true,
        );

        assert!(!should_upgrade);
    }

    #[test]
    fn cpu_target_keeps_existing_torch() {
        let should_upgrade = should_install_or_upgrade_torch(
            TorchInstallTarget::Cpu,
            true,
            false,
        );

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
