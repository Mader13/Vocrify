!macro NSIS_HOOK_PREINSTALL
  ; Tauri NSIS template does not bundle Rust runtime DLL deps automatically.
  ; These must sit next to Vocrify.exe for Windows loader.
  File "/oname=sherpa-onnx-c-api.dll" "${MAINBINARYSRCPATH}\..\sherpa-onnx-c-api.dll"
  File "/oname=sherpa-onnx-cxx-api.dll" "${MAINBINARYSRCPATH}\..\sherpa-onnx-cxx-api.dll"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\sherpa-onnx-c-api.dll"
  Delete "$INSTDIR\sherpa-onnx-cxx-api.dll"
!macroend
