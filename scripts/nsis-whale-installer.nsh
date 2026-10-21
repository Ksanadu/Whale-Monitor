; Intentionally independent from Token Monitor's migration/process hooks.
; electron-builder supplies installation and uninstall behavior for our appId.
!macro customInstall
  FileOpen $0 "$INSTDIR\whale-installation.json" w
  FileWrite $0 '{"kind":"nsis","appId":"com.ksanadu.whalemonitor"}'
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\whale-installation.json"
!macroend
