# Startup Performance Optimization Design

**Date**: 2025-02-17
**Status**: Approved
**Goal**: Reduce TTUI (Time To UI Interaction) by 30-50%

---

## Overview

This design implements a fast-path setup validation system with 7-day TTL, lazy initialization of heavy components, and deferred device detection to dramatically improve startup performance.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  App Start                                                   │
│  ├── setupStore.initialize()                                │
│  │   ├── is_setup_complete_fast()  ← NEW (fast path)        │
│  │   │   ├── Load setup_state.json                          │
│  │   │   ├── If runtime_ready=true AND age < 7 days → TRUE  │
│  │   │   └── Else: fallback to is_setup_complete()          │
│  │   └── UI renders WITHOUT blocking Python                 │
│  │                                                           │
│  ├── Background (post-render)                                │
│  │   ├── is_setup_complete() ← full validation              │
│  │   └── Update setup_state.json                            │
│  │                                                           │
│  └── TranscriptionManager                                    │
│      └── spawn async task after window ready                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Fast Setup Check

### Rust Backend

```rust
#[tauri::command]
async fn is_setup_complete_fast(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let setup_state = load_setup_state(&state.setup_state_path)?;

    if setup_state.runtime_ready {
        let last_verified = DateTime::parse_from_rfc3339(&setup_state.last_verified_at)?;
        let days_old = Utc::now().signed_duration_since(last_verified).num_days();

        if days_old < 7 {  // TTL: 7 days
            return Ok(true);
        }
    }

    // Fallback to full check
    is_setup_complete(state).await
}
```

### Frontend

```typescript
async initialize() {
  const isReady = await invoke<boolean>('is_setup_complete_fast');
  this.isSetupComplete = isReady;

  // Background validation (doesn't block UI)
  this.backgroundValidate();
}
```

---

## Phase 2: Lazy TranscriptionManager

```rust
.setup(|app| {
    let app_handle = app.handle().clone();

    // Don't block on manager
    tauri::async_runtime::spawn(async move {
        let manager = build_transcription_manager(&app_handle).await;
        TRANSCRIPTION_MANAGER.lock().await.replace(manager);
    });

    Ok(())
})
```

---

## Phase 3: Deferred Device Detection

```rust
lazy_static! {
    static ref DEVICE_CACHE: Arc<Mutex<Option<DeviceInfo>>>> = Arc::new(Mutex::new(None));
}

#[tauri::command]
async fn get_available_devices(
    refresh: bool,  // force refresh flag
) -> Result<DeviceInfo, String> {
    let mut cache = DEVICE_CACHE.lock().await;

    if cache.is_some() && !refresh {
        return Ok(cache.clone().unwrap());
    }

    let devices = detect_devices_impl().await?;
    *cache = Some(devices.clone());
    Ok(devices)
}
```

---

## Phase 4: Feature Flags

```rust
pub struct PerformanceConfig {
    pub fast_setup_check_enabled: bool,      // default: true
    pub lazy_manager_init_enabled: bool,     // default: true
    pub defer_device_detection_enabled: bool, // default: true
    pub setup_cache_ttl_days: i64,           // default: 7
}
```

---

## Error Handling

- Corrupted setup_state.json → fallback to full check
- Background validation failure → continue with cached state
- Show warning badge: "Last check: X days ago"

---

## Definition of Done

- [ ] TTUI reduced by 30-50% (cold start)
- [ ] No regressions in setup wizard
- [ ] Full-check available manually
- [ ] Feature flags enable quick rollback
- [ ] Diagnostic logs for startup issues

---

## Implementation Phases

1. **Fast Setup Check** - Add is_setup_complete_fast() endpoint
2. **Lazy Manager Init** - Async spawn after window ready
3. **Deferred Device Detection** - Cache + on-demand fetch
4. **Feature Flags** - Config structure + wiring
5. **Testing** - Unit + integration + E2E + benchmarks
