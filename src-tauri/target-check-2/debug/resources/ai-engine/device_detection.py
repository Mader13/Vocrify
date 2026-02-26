#!/usr/bin/env python3
"""
Device Detection Module for Transcribe Video AI Engine.

Detects available compute devices for ML inference:
- CPU (always available)
- CUDA (NVIDIA GPUs)
- MPS (Apple Silicon M1/M2/M3)
- Vulkan (AMD/Intel GPUs)

Provides automatic selection of the best available device.
"""

import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Optional


class DeviceType(Enum):
    """Supported compute device types."""

    CPU = "cpu"
    CUDA = "cuda"
    MPS = "mps"  # Apple Metal Performance Shaders
    VULKAN = "vulkan"  # AMD/Intel GPUs via Vulkan


@dataclass
class DeviceInfo:
    """Information about a compute device."""

    type: str
    name: str
    available: bool
    memory_mb: Optional[int] = None
    compute_capability: Optional[str] = None
    is_recommended: bool = False


import platform
import shutil

def detect_cuda() -> Optional[DeviceInfo]:
    """
    Detect CUDA-capable NVIDIA GPU using nvidia-smi.

    Returns:
        DeviceInfo if CUDA is available, None otherwise
    """
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return None

    try:
        # Get GPU name and memory info using nvidia-smi
        result = subprocess.run(
            [nvidia_smi, "--query-gpu=name,memory.total,compute_cap", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True
        )
        
        output = result.stdout.strip()
        if not output:
            return None

        # Format: "NVIDIA GeForce RTX 4060, 8188, 8.9"
        parts = [p.strip() for p in output.split(",")]
        if len(parts) >= 1:
            name = parts[0]
            memory_mb = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            compute_cap = parts[2] if len(parts) > 2 else None

            return DeviceInfo(
                type=DeviceType.CUDA.value,
                name=name,
                available=True,
                memory_mb=memory_mb,
                compute_capability=compute_cap,
            )
    except Exception:
        # Fallback if nvidia-smi fails or returns unexpected format
        pass

    return None


def detect_mps() -> Optional[DeviceInfo]:
    """
    Detect Apple Metal Performance Shaders (MPS) for Apple Silicon.

    Returns:
        DeviceInfo if MPS is available, None otherwise
    """
    if platform.system() != "Darwin":
        return None

    # Check for Apple Silicon (arm64)
    is_arm = platform.processor() == "arm" or platform.machine() == "arm64"
    
    if is_arm:
        return DeviceInfo(
            type=DeviceType.MPS.value,
            name="Apple Silicon GPU",
            available=True,
            memory_mb=None,
        )
    
    return None


def detect_vulkan() -> Optional[DeviceInfo]:
    """
    Detect Vulkan-capable GPU (AMD/Intel) via vulkaninfo.

    Returns:
        DeviceInfo if Vulkan is available, None otherwise
    """
    try:
        result = subprocess.run(
            ["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            # Parse GPU name from output
            gpu_name = _parse_vulkan_gpu_name(result.stdout)
            return DeviceInfo(
                type=DeviceType.VULKAN.value,
                name=gpu_name,
                available=True,
                is_recommended=False,  # Will be set by get_recommended_device
            )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    except Exception as e:
        return DeviceInfo(
            type=DeviceType.VULKAN.value,
            name=f"Vulkan GPU - Error: {str(e)}",
            available=False,
        )
    return None


def _parse_vulkan_gpu_name(output: str) -> str:
    """
    Extract GPU name from vulkaninfo output.

    Args:
        output: stdout from vulkaninfo --summary

    Returns:
        GPU name string
    """
    for line in output.split("\n"):
        # vulkaninfo --summary format: "deviceName = NVIDIA GeForce RTX 4060"
        if "deviceName" in line:
            parts = line.split("=")
            if len(parts) >= 2:
                return parts[-1].strip()
        # Alternative format: "GPU0: NVIDIA GeForce RTX 4060"
        if "GPU" in line and ":" in line:
            parts = line.split(":")
            if len(parts) >= 2:
                return parts[-1].strip()
    return "Unknown Vulkan GPU"


def get_cpu_info() -> DeviceInfo:
    """
    Get CPU device info.

    CPU is always available as fallback.

    Returns:
        DeviceInfo for CPU
    """
    try:
        import multiprocessing

        cpu_count = multiprocessing.cpu_count()
        name = f"CPU ({cpu_count} cores)"
    except Exception:
        name = "CPU"

    return DeviceInfo(
        type=DeviceType.CPU.value,
        name=name,
        available=True,
    )


def detect_all_devices() -> list[DeviceInfo]:
    """
    Detect all available compute devices.

    Returns:
        List of DeviceInfo for all detected devices
    """
    devices = []

    # CPU is always available
    devices.append(get_cpu_info())

    # Detect CUDA (NVIDIA GPU)
    cuda_info = detect_cuda()
    if cuda_info:
        devices.append(cuda_info)

    # Detect MPS (Apple Silicon)
    mps_info = detect_mps()
    if mps_info:
        devices.append(mps_info)

    # Detect Vulkan (AMD/Intel GPU)
    vulkan_info = detect_vulkan()
    if vulkan_info:
        devices.append(vulkan_info)

    return devices


def get_recommended_device(devices: list[DeviceInfo]) -> DeviceInfo:
    """
    Get the recommended device based on availability and performance.

    Priority: CUDA > MPS > Vulkan > CPU

    Args:
        devices: List of available devices

    Returns:
        The recommended DeviceInfo
    """
    # Priority order
    priority = {
        DeviceType.CUDA.value: 4,  # Best for NVIDIA
        DeviceType.MPS.value: 3,  # Best for Apple
        DeviceType.VULKAN.value: 2,  # Good for AMD/Intel
        DeviceType.CPU.value: 1,  # Fallback
    }

    # Filter available devices
    available = [d for d in devices if d.available]

    if not available:
        # Fallback to CPU (should always be available)
        return devices[0] if devices else get_cpu_info()

    # Sort by priority
    available.sort(key=lambda d: priority.get(d.type, 0), reverse=True)

    # Mark the recommended device
    recommended = available[0]
    recommended.is_recommended = True

    return recommended


def get_device_for_pytorch(device_type: str) -> str:
    """
    Convert device type to PyTorch device string.

    Args:
        device_type: Device type string ("cpu", "cuda", "mps", "vulkan", "auto")

    Returns:
        PyTorch-compatible device string
    """
    if device_type == "auto":
        devices = detect_all_devices()
        recommended = get_recommended_device(devices)
        return recommended.type

    # Validate device type
    valid_types = {
        DeviceType.CPU.value,
        DeviceType.CUDA.value,
        DeviceType.MPS.value,
        DeviceType.VULKAN.value,
    }
    if device_type not in valid_types:
        print(
            json.dumps(
                {
                    "type": "warning",
                    "message": f"Unknown device type '{device_type}', falling back to CPU",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
        return DeviceType.CPU.value

    return device_type


def emit_device_info():
    """
    Emit device information as JSON to stdout.

    This is the main entry point for the IPC protocol.
    Outputs a JSON object with all detected devices and the recommended one.
    """
    devices = detect_all_devices()
    recommended = get_recommended_device(devices)

    # Convert to dict for JSON serialization
    devices_data = [asdict(d) for d in devices]

    result = {
        "type": "devices",
        "devices": devices_data,
        "recommended": asdict(recommended),
    }

    print(json.dumps(result), flush=True)


def main():
    """CLI entry point for testing device detection."""
    print("Detecting available compute devices...\n")

    devices = detect_all_devices()
    recommended = get_recommended_device(devices)

    for device in devices:
        status = "✓" if device.available else "✗"
        rec = " [RECOMMENDED]" if device.is_recommended else ""
        print(f"  {status} {device.name} ({device.type}){rec}")
        if device.available and device.memory_mb:
            print(f"      Memory: {device.memory_mb} MB")
        if device.available and device.compute_capability:
            print(f"      Compute Capability: {device.compute_capability}")

    print(f"\nRecommended device: {recommended.name} ({recommended.type})")

    # Also output JSON
    print("\nJSON output:")
    emit_device_info()


if __name__ == "__main__":
    main()
