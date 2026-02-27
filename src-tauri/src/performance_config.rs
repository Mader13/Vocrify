//! Performance Configuration - Feature Flags for Performance Optimizations
//!
//! This module provides configurable feature flags to control various performance
//! optimizations in the application. These flags can be toggled via:
//! - Environment variables (for development/testing)
//! - Configuration file (for production persistence)
//!
//! # Environment Variables
//! - `TV_FAST_SETUP_CHECK` - Enable fast setup check (default: true)
//! - `TV_LAZY_MANAGER_INIT` - Enable lazy TranscriptionManager init (default: true)
//! - `TV_DEFER_DEVICE_DETECTION` - Enable deferred device detection (default: true)
//! - `TV_SETUP_CACHE_TTL_DAYS` - Setup cache TTL in days (default: 7)

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::Path;
use std::time::Duration;

/// Configuration for performance optimizations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    /// Enable fast setup check (skip full readiness evaluation if recently verified)
    pub fast_setup_check_enabled: bool,
    /// Enable lazy TranscriptionManager initialization
    pub lazy_manager_init_enabled: bool,
    /// Enable deferred device detection (only detect when needed)
    pub defer_device_detection_enabled: bool,
    /// Number of days setup cache is considered valid
    pub setup_cache_ttl_days: i64,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            fast_setup_check_enabled: true,
            lazy_manager_init_enabled: true,
            defer_device_detection_enabled: true,
            setup_cache_ttl_days: 7,
        }
    }
}

impl PerformanceConfig {
    /// Load configuration from environment variables and config file
    ///
    /// Priority: Environment variables > Config file > Defaults
    pub fn load(config_dir: &Path) -> Self {
        let mut config = Self::default();

        // Load from config file if it exists
        if let Ok(loaded) = Self::load_from_file(config_dir) {
            config = loaded;
        }

        // Override with environment variables (take precedence)
        config = config.with_env_overrides();

        config
    }

    /// Load configuration from a JSON file
    fn load_from_file(config_dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let config_path = config_dir.join("performance_config.json");

        if !config_path.exists() {
            return Ok(Self::default());
        }

        let content = fs::read_to_string(&config_path)?;
        let config: PerformanceConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Save configuration to a JSON file
    pub fn save_to_file(&self, config_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let config_path = config_dir.join("performance_config.json");

        // Ensure config directory exists
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = serde_json::to_string_pretty(self)?;
        fs::write(&config_path, content)?;

        Ok(())
    }

    /// Apply environment variable overrides to the config
    pub fn with_env_overrides(mut self) -> Self {
        // Parse boolean from environment variable
        let parse_bool = |key: &str, default: bool| -> bool {
            match env::var(key) {
                Ok(val) => {
                    let val_lower = val.to_lowercase();
                    val_lower == "true"
                        || val_lower == "1"
                        || val_lower == "yes"
                        || val_lower == "on"
                }
                Err(_) => default,
            }
        };

        // Parse integer from environment variable
        let parse_int = |key: &str, default: i64| -> i64 {
            match env::var(key) {
                Ok(val) => val.parse().unwrap_or(default),
                Err(_) => default,
            }
        };

        self.fast_setup_check_enabled =
            parse_bool("TV_FAST_SETUP_CHECK", self.fast_setup_check_enabled);
        self.lazy_manager_init_enabled =
            parse_bool("TV_LAZY_MANAGER_INIT", self.lazy_manager_init_enabled);
        self.defer_device_detection_enabled = parse_bool(
            "TV_DEFER_DEVICE_DETECTION",
            self.defer_device_detection_enabled,
        );
        self.setup_cache_ttl_days = parse_int("TV_SETUP_CACHE_TTL_DAYS", self.setup_cache_ttl_days);

        self
    }

    /// Get the setup cache TTL as a Duration
    pub fn setup_cache_ttl(&self) -> Duration {
        Duration::from_secs(self.setup_cache_ttl_days as u64 * 24 * 60 * 60)
    }

    /// Log the current configuration status
    pub fn log_status(&self) {
        eprintln!("[PERF] Performance Configuration:");
        eprintln!(
            "[PERF]   fast_setup_check_enabled = {}",
            self.fast_setup_check_enabled
        );
        eprintln!(
            "[PERF]   lazy_manager_init_enabled = {}",
            self.lazy_manager_init_enabled
        );
        eprintln!(
            "[PERF]   defer_device_detection_enabled = {}",
            self.defer_device_detection_enabled
        );
        eprintln!(
            "[PERF]   setup_cache_ttl_days = {}",
            self.setup_cache_ttl_days
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = PerformanceConfig::default();
        assert!(config.fast_setup_check_enabled);
        assert!(config.lazy_manager_init_enabled);
        assert!(config.defer_device_detection_enabled);
        assert_eq!(config.setup_cache_ttl_days, 7);
    }

    #[test]
    fn test_env_override() {
        // Test with actual environment variable set (needs to be set before test)
        // This is mainly a compile-time check
        let config = PerformanceConfig::default().with_env_overrides();
        assert_eq!(config.setup_cache_ttl_days, 7); // Default if not set
    }

    #[test]
    fn test_ttl_duration() {
        let config = PerformanceConfig::default();
        let duration = config.setup_cache_ttl();
        assert_eq!(duration.as_secs(), 7 * 24 * 60 * 60);
    }
}
