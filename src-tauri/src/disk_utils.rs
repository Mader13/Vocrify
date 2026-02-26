//! Disk space utilities
//!
//! Cross-platform free space detection using platform-specific system calls.
//! No extra crate dependencies required.

use std::path::Path;

/// Returns free disk space in megabytes for the drive containing `path`.
/// Returns 0 if detection fails.
pub fn get_free_space_mb(path: &Path) -> u64 {
    get_free_space_bytes(path).unwrap_or(0) / (1024 * 1024)
}

#[cfg(target_os = "windows")]
fn get_free_space_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;

    // Canonicalize to resolve \\?\ prefix / relative paths
    let canonical = std::fs::canonicalize(path).ok()?;
    let wide: Vec<u16> = canonical
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_bytes_available: u64 = 0;
    let mut _total_bytes: u64 = 0;
    let mut _total_free_bytes: u64 = 0;

    // SAFETY: Calling a well-defined Windows API with valid aligned pointers.
    // `wide` is null-terminated. Output pointers are stack-local u64s.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes_available,
            &mut _total_bytes,
            &mut _total_free_bytes,
        )
    };

    if ok != 0 {
        Some(free_bytes_available)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
extern "system" {
    /// <https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespaceexw>
    fn GetDiskFreeSpaceExW(
        lpDirectoryName: *const u16,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> i32;
}

#[cfg(target_os = "macos")]
fn get_free_space_bytes(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;

    let canonical = std::fs::canonicalize(path).ok()?;
    let c_path = CString::new(canonical.to_str()?).ok()?;

    // SAFETY: statvfs is POSIX-standard. `buf` is written before read.
    // `c_path` is a valid null-terminated C string.
    let mut buf = MaybeUninit::<libc::statvfs>::uninit();
    let ret = unsafe { libc::statvfs(c_path.as_ptr(), buf.as_mut_ptr()) };

    if ret == 0 {
        // SAFETY: statvfs returned 0, so the buffer is fully initialized.
        let stat = unsafe { buf.assume_init() };
        // f_bavail = blocks available to unprivileged users
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn get_free_space_bytes(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;

    let canonical = std::fs::canonicalize(path).ok()?;
    let c_path = CString::new(canonical.to_str()?).ok()?;

    // SAFETY: statvfs is POSIX-standard. `buf` is written before read.
    // `c_path` is a valid null-terminated C string.
    let mut buf = MaybeUninit::<libc::statvfs>::uninit();
    let ret = unsafe { libc::statvfs(c_path.as_ptr(), buf.as_mut_ptr()) };

    if ret == 0 {
        // SAFETY: statvfs returned 0, so the buffer is fully initialized.
        let stat = unsafe { buf.assume_init() };
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    } else {
        None
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn get_free_space_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_free_space_returns_nonzero_for_temp_dir() {
        let tmp = std::env::temp_dir();
        let free = get_free_space_mb(&tmp);
        // Should return > 0 on any system with free disk space
        assert!(free > 0, "Expected free space > 0, got {}", free);
    }

    #[test]
    fn test_free_space_nonexistent_path_returns_zero() {
        let bad = Path::new("/nonexistent/path/that/does/not/exist");
        let free = get_free_space_mb(bad);
        assert_eq!(free, 0);
    }
}
