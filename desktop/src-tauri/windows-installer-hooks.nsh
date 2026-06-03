!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Ycode sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running Ycode processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM ycode-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend
