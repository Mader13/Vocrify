# HuggingFace Token Fix for Diarization

## Summary

Fixed the Rust backend to properly retrieve and pass the HuggingFace token to the Python AI engine when using pyannote diarization. The token is now stored in the Rust backend's store file and passed as environment variables during transcription.

## Changes Made

### 1. Rust Backend (`src-tauri/src/lib.rs`)

#### Added `get_huggingface_token()` helper function
- Retrieves the HuggingFace token from the app store file
- Returns `Ok(None)` if store file doesn't exist or token is empty
- Location: Lines 1069-1083

#### Added `save_huggingface_token` Tauri command
- Saves the HuggingFace token to the store file
- Preserves existing store data when updating the token
- Creates store directory if it doesn't exist
- Location: Lines 1085-1110

#### Added `get_huggingface_token_command` Tauri command
- Public Tauri command wrapper for `get_huggingface_token()`
- Allows frontend to retrieve the stored token
- Location: Lines 1112-1114

#### Updated `spawn_transcription()` function
- Retrieves HuggingFace token when pyannote diarization is enabled
- Sets token as environment variables: `HUGGINGFACE_ACCESS_TOKEN` and `HF_TOKEN`
- Only sets env vars when using pyannote provider
- Logs debug messages when token is found or missing
- Location: Lines 479-498

#### Registered new commands in invoke handler
- Added `save_huggingface_token` and `get_huggingface_token_command`
- Location: Lines 1628-1634

### 2. Frontend Store (`src/stores/index.ts`)

#### Updated `setHuggingFaceToken()` to be async
- Now saves token to Rust backend when updated
- Handles errors gracefully with logging
- Location: Lines 167-178

#### Added token loading on store initialization
- Loads token from Rust backend when store is created
- Uses async IIFE to load token without blocking initialization
- Syncs token between frontend localStorage and backend store
- Location: Lines 102-116

### 3. Frontend Service (`src/services/tauri.ts`)

#### Added `saveHuggingFaceToken()` function
- Tauri wrapper for `save_huggingface_token` command
- Returns `CommandResult<void>` type
- Includes error logging
- Location: Lines 387-396

#### Added `getHuggingFaceToken()` function
- Tauri wrapper for `get_huggingface_token_command` command
- Returns `CommandResult<string | null>` type
- Includes error logging
- Location: Lines 398-407

## How It Works

### Token Storage Flow
1. User enters token in `HuggingFaceTokenCard` component
2. Token saved to frontend Zustand store via `setHuggingFaceToken()`
3. Token saved to Rust backend store file via `save_huggingface_token` command
4. Token persisted across app restarts in both locations

### Token Usage Flow
1. User starts transcription with pyannote diarization enabled
2. Frontend calls `startTranscription()` via Tauri
3. Rust backend retrieves token from store file via `get_huggingface_token()`
4. Token set as environment variables (`HUGGINGFACE_ACCESS_TOKEN` and `HF_TOKEN`)
5. Python process spawned with token available in environment
6. pyannote.audio reads token from environment variable

### Token Loading Flow
1. App starts and store initializes
2. Frontend calls `getHuggingFaceToken()` command
3. Rust backend reads token from store file
4. Frontend syncs token to Zustand store
5. Token available immediately for transcription

## Environment Variables

The following environment variables are set for the Python process:

- `HUGGINGFACE_ACCESS_TOKEN` - Primary token variable (used by huggingface_hub)
- `HF_TOKEN` - Alternative token variable (modern convention)

Both are set to the same value for maximum compatibility.

## Security Considerations

- Token stored in app data directory (`AppData/Vocrify/store.json` on Windows)
- Token passed as environment variable (process-scoped, not system-wide)
- Token only passed when pyannote diarization is enabled
- Token file not created for diarization (unlike model downloads)
- Token cleared from environment when Python process exits

## Testing

To test the fix:

1. Enter HuggingFace token in Settings > Models
2. Start transcription with diarization enabled using pyannote
3. Check Rust backend logs for: `[DEBUG] Found HuggingFace token, setting as environment variable`
4. Verify pyannote model loads without authentication error
5. Restart app and verify token persists (loaded from backend)

## Files Modified

- `src-tauri/src/lib.rs` - Backend token storage and passing
- `src/stores/index.ts` - Frontend token management
- `src/services/tauri.ts` - Tauri command wrappers

## Notes

- Token synchronization happens automatically on app start
- Frontend localStorage remains as backup/primary storage
- Backend store used for process spawning (cannot access localStorage)
- Graceful degradation: missing token shows warning but doesn't crash
