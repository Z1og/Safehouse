; Assisted installer, restricted to the current Windows user.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; This installer is always per-user. Start the installed executable directly:
; shelling a .lnk through Explorer can hang on systems with shell extensions.
!macro customFinishPage
  Function SafehouseStartApp
    ${if} ${isUpdated}
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --updated'
    ${else}
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${endif}
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "SafehouseStartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  ${if} ${Silent}
  ${andIf} ${isForceRun}
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --updated'
    !insertmacro quitSuccess
  ${endif}
!macroend
