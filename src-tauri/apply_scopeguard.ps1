# PowerShell script to apply scopeguard fix to lib.rs
$librsPath = "E:\Dev\Transcribe-video\src-tauri\src\lib.rs"

# Read the file
$content = Get-Content $librsPath -Raw

# Apply scopeguard import fix
$content = $content -replace '(?m)^use tauri_plugin_dialog::DialogExt;$', "use tauri_plugin_dialog::DialogExt;`r`nuse scopeguard::scopeguard;"

# Apply the child process scopeguard wrapper (line 367 area)
$oldSpawn = '    let mut child = cmd.spawn\(\)\?;`r`n`r`n    let stdout = child\.stdout\.take\(\)\.expect\("Failed to capture stdout"\);`r`n    let stderr = child\.stderr\.take\(\)\.expect\("Failed to capture stderr"\);`r`n    let mut reader = BufReader::new\(stdout\)\.lines\(\);`r`n    let mut stderr_reader = BufReader::new\(stderr\)\.lines\(\);'

$newSpawn = '    let mut child = cmd.spawn()?;`r`n`r`n    // CRITICAL FIX: Wrap child process with scopeguard to ensure cleanup`r`n    // This prevents zombie processes if the reading loop exits early`r`n    let child_guard = scopeguard(child, |mut child| {`r`n        eprintln!("[SCOPEGUARD] Cleaning up child process due to early exit");`r`n        let _ = child.start_kill();`r`n    });`r`n`r`n    let stdout = child_guard.stdout.take().expect("Failed to capture stdout");`r`n    let stderr = child_guard.stderr.take().expect("Failed to capture stderr");`r`n    let mut reader = BufReader::new(stdout).lines();`r`n    let mut stderr_reader = BufReader::new(stderr).lines();'

$content = $content -replace [regex]::Escape($oldSpawn), $newSpawn

# Apply the wait() fix (line 434 area)
$oldWait = '    let status = child\.wait\(\)\.await\?;'
$newWait = '    // CRITICAL FIX: Release the guard after successful read and wait for process`r`n    // This prevents the cleanup function from running since we reached wait() successfully`r`n    let status = scopeguard::into_inner(child_guard).wait().await?;'

$content = $content -replace $oldWait, $newWait

# Write back
Set-Content -Path $librsPath -Value $content -NoNewline

Write-Host "Applied scopeguard fix successfully!"
