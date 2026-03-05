use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex;

use crate::{
    app_state::{RustTaskHandles, TaskManagerState, DEVICE_CACHE},
    AppError, DeviceInfo, DevicesResponse,
};

pub(crate) async fn cancel_transcription(
    task_manager: &State<'_, TaskManagerState>,
    rust_handles: &State<'_, RustTaskHandles>,
    task_id: String,
) -> Result<(), AppError> {
    let mut manager = task_manager.lock().await;

    if let Some(running_task) = manager.running_tasks.remove(&task_id) {
        let mut child = running_task.child_process.lock().await;
        if let Some(mut proc) = child.take() {
            let _ = proc.start_kill();
            let _ = proc.wait().await;
        }
        drop(child);

        running_task.handle.abort();
        return Ok(());
    }

    manager.queued_tasks.retain(|t| t.id != task_id);
    drop(manager);

    if let Some(handle) = rust_handles.lock().await.remove(&task_id) {
        eprintln!("[INFO] Aborting Rust transcription task: {}", task_id);
        handle.abort();
    }

    Ok(())
}

pub(crate) async fn get_queue_status(
    task_manager: &State<'_, TaskManagerState>,
) -> Result<serde_json::Value, AppError> {
    let manager = task_manager.lock().await;

    Ok(serde_json::json!({
        "running": manager.running_tasks.len(),
        "queued": manager.queued_tasks.len(),
    }))
}

pub(crate) async fn get_available_devices(refresh: bool) -> Result<DevicesResponse, AppError> {
    let cache = DEVICE_CACHE.get_or_init(|| Arc::new(Mutex::new(None)));

    if !refresh {
        let cached = cache.lock().await;
        if let Some(ref devices) = *cached {
            eprintln!("[DEBUG] get_available_devices: returning cached result");
            return Ok(devices.clone());
        }
        drop(cached);
    }

    eprintln!(
        "[DEBUG] get_available_devices: running native device detection (refresh={})",
        refresh
    );

    let mut devices = Vec::new();

    devices.push(DeviceInfo {
        device_type: "cpu".to_string(),
        name: "CPU".to_string(),
        available: true,
        memory_mb: None,
        compute_capability: None,
        is_recommended: false,
    });

    #[cfg(target_os = "macos")]
    {
        let is_apple_silicon = std::env::consts::ARCH == "aarch64";
        devices.push(DeviceInfo {
            device_type: "mps".to_string(),
            name: "Apple Silicon".to_string(),
            available: is_apple_silicon,
            memory_mb: None,
            compute_capability: None,
            is_recommended: is_apple_silicon,
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        devices.push(DeviceInfo {
            device_type: "mps".to_string(),
            name: "Apple Silicon".to_string(),
            available: false,
            memory_mb: None,
            compute_capability: None,
            is_recommended: false,
        });
    }

    let mut cuda_available = false;
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let smi_cmd = "nvidia-smi";

        let mut cmd = tokio::process::Command::new(smi_cmd);
        cmd.arg("--query-gpu=name,memory.total");
        cmd.arg("--format=csv,noheader,nounits");

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = stdout.lines().next() {
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() == 2 {
                        let name = parts[0].trim().to_string();
                        let mem_str = parts[1].trim();
                        let memory_mb = mem_str.parse::<u64>().ok();

                        devices.push(DeviceInfo {
                            device_type: "cuda".to_string(),
                            name,
                            available: true,
                            memory_mb,
                            compute_capability: None,
                            is_recommended: true,
                        });
                        cuda_available = true;
                    }
                }
            }
        }
    }

    if !cuda_available {
        devices.push(DeviceInfo {
            device_type: "cuda".to_string(),
            name: "CPU Fallback".to_string(),
            available: false,
            memory_mb: None,
            compute_capability: None,
            is_recommended: false,
        });
    }

    let mut vulkan_available = false;
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let mut cmd = tokio::process::Command::new("vulkaninfo");
        cmd.arg("--summary");

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);

                let mut vulkan_name = "Vulkan GPU".to_string();
                let mut found_discrete = false;

                for line in stdout.lines() {
                    let line = line.trim();
                    if line.starts_with("deviceName") {
                        if let Some(idx) = line.find('=') {
                            vulkan_name = line[idx + 1..].trim().to_string();
                        }
                    }
                    if line.starts_with("deviceType") && line.contains("DISCRETE_GPU") {
                        found_discrete = true;
                    }
                }

                let is_nvidia = vulkan_name.to_lowercase().contains("nvidia");

                if stdout.contains("VULKANINFO") && (!is_nvidia || !cuda_available) {
                    devices.push(DeviceInfo {
                        device_type: "vulkan".to_string(),
                        name: vulkan_name,
                        available: true,
                        memory_mb: None,
                        compute_capability: None,
                        is_recommended: !cuda_available && found_discrete,
                    });
                    vulkan_available = true;
                }
            }
        }
    }

    if !vulkan_available {
        devices.push(DeviceInfo {
            device_type: "vulkan".to_string(),
            name: "Vulkan".to_string(),
            available: false,
            memory_mb: None,
            compute_capability: None,
            is_recommended: false,
        });
    }

    let recommended = if cuda_available {
        "cuda".to_string()
    } else if vulkan_available {
        "vulkan".to_string()
    } else {
        #[cfg(target_os = "macos")]
        {
            if std::env::consts::ARCH == "aarch64" {
                "mps".to_string()
            } else {
                "cpu".to_string()
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            "cpu".to_string()
        }
    };

    if recommended == "cpu" {
        if let Some(cpu) = devices.iter_mut().find(|d| d.device_type == "cpu") {
            cpu.is_recommended = true;
        }
    }

    let response = DevicesResponse {
        devices,
        recommended,
    };

    *cache.lock().await = Some(response.clone());
    eprintln!("[DEBUG] get_available_devices: cached result");

    Ok(response)
}
