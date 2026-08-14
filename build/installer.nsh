; Detect and optionally install independently installed dsh during shell setup.
; Skip the whole page when compiling the uninstaller.

!ifndef BUILD_UNINSTALLER
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var dshDetectDialog
Var dshDetectText
Var dshDetectStatus
Var dshInstallBtn

!macro customPageAfterChangeDir
  Page custom dshDetectPageCreate
!macroend

Function FindNodeExe
  StrCpy $R8 ""
  IfFileExists "$LOCALAPPDATA\Programs\nodejs\node.exe" 0 +3
    StrCpy $R8 "$LOCALAPPDATA\Programs\nodejs\node.exe"
    Goto node_done
  IfFileExists "$PROGRAMFILES64\nodejs\node.exe" 0 +3
    StrCpy $R8 "$PROGRAMFILES64\nodejs\node.exe"
    Goto node_done
  IfFileExists "$PROGRAMFILES\nodejs\node.exe" 0 +3
    StrCpy $R8 "$PROGRAMFILES\nodejs\node.exe"
    Goto node_done
  nsExec::ExecToStack 'cmd /c where node'
  Pop $0
  Pop $1
  ${If} $0 == "0"
    StrCpy $R8 $1 260
    Push $R8
    Call TrimNewlines
    Pop $R8
  ${EndIf}
  node_done:
FunctionEnd

Function TrimNewlines
  Exch $0
  Push $1
  Push $2
  trim_loop:
    StrLen $1 $0
    IntCmp $1 0 trim_done
    IntOp $1 $1 - 1
    StrCpy $2 $0 1 $1
    StrCmp $2 "$\r" trim_cut
    StrCmp $2 "$\n" trim_cut
    Goto trim_done
  trim_cut:
    StrCpy $0 $0 $1
    Goto trim_loop
  trim_done:
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

Function ExtractDshTools
  InitPluginsDir
  File "/oname=$PLUGINSDIR\lifecycle.js" "${BUILD_RESOURCES_DIR}\lifecycle.js"
  File "/oname=$PLUGINSDIR\detect-dsh.js" "${BUILD_RESOURCES_DIR}\detect-dsh.js"
  File "/oname=$PLUGINSDIR\install-dsh.js" "${BUILD_RESOURCES_DIR}\install-dsh.js"
FunctionEnd

Function RunShippedDshDetect
  Call ExtractDshTools
  Call FindNodeExe
  ${If} $R8 == ""
    StrCpy $dshDetectStatus "MISSING"
    StrCpy $R9 "未检测到 Node.js，无法检查或安装 dsh。$\r$\n$\r$\n请先安装 Node.js，再点「立即安装 dsh」。"
    Return
  ${EndIf}

  System::Call 'Kernel32::SetEnvironmentVariable(t "DSH_DETECT_OUT", t "$PLUGINSDIR\dsh-detect.txt")i.r0'
  nsExec::ExecToStack '"$R8" "$PLUGINSDIR\detect-dsh.js"'
  Pop $0
  Pop $1

  IfFileExists "$PLUGINSDIR\dsh-detect.txt" 0 detect_fallback
    FileOpen $2 "$PLUGINSDIR\dsh-detect.txt" r
    FileRead $2 $3
    FileRead $2 $4
    FileClose $2
    Push $3
    Call TrimNewlines
    Pop $3
    Push $4
    Call TrimNewlines
    Pop $4
    ${If} $3 == "FOUND"
      StrCpy $dshDetectStatus "FOUND"
      StrCpy $R9 "已检测到本机的 dsh：$\r$\n$4$\r$\n$\r$\n可以继续安装外壳。之后可用 npm update -g @deepseek-ai/dsh 单独升级。"
      Return
    ${EndIf}
    StrCpy $dshDetectStatus "MISSING"
    StrCpy $R9 "未检测到 dsh。$\r$\n$\r$\n点下面的「立即安装 dsh」，安装程序会替你执行 npm install -g @deepseek-ai/dsh（不会把 dsh 打进外壳）。"
    Return
  detect_fallback:
    StrCpy $dshDetectStatus "MISSING"
    StrCpy $R9 "未能完成 dsh 检测。可点「立即安装 dsh」再试。"
FunctionEnd

Function OnInstallDsh
  Call ExtractDshTools
  Call FindNodeExe
  ${If} $R8 == ""
    StrCpy $R9 "未找到 Node.js，无法自动安装 dsh。请先安装 Node.js。"
    ${NSD_SetText} $dshDetectText "$R9"
    Return
  ${EndIf}
  EnableWindow $dshInstallBtn 0
  ${NSD_SetText} $dshDetectText "正在安装 dsh，请稍候…"
  System::Call 'Kernel32::SetEnvironmentVariable(t "DSH_INSTALL_OUT", t "$PLUGINSDIR\dsh-install.txt")i.r0'
  nsExec::ExecToStack '"$R8" "$PLUGINSDIR\install-dsh.js"'
  Pop $0
  Pop $1
  IfFileExists "$PLUGINSDIR\dsh-install.txt" 0 install_fail
    FileOpen $2 "$PLUGINSDIR\dsh-install.txt" r
    FileRead $2 $3
    FileRead $2 $4
    FileClose $2
    Push $3
    Call TrimNewlines
    Pop $3
    Push $4
    Call TrimNewlines
    Pop $4
    ${If} $3 == "FOUND"
      StrCpy $dshDetectStatus "FOUND"
      StrCpy $R9 "已为你安装 dsh：$\r$\n$4$\r$\n$\r$\n可以继续安装外壳。"
      ${NSD_SetText} $dshDetectText "$R9"
      Return
    ${EndIf}
  install_fail:
    StrCpy $dshDetectStatus "MISSING"
    StrCpy $R9 "自动安装失败。$\r$\n请确认已安装 Node.js 且能访问 npm 仓库，然后重试「立即安装 dsh」。"
    ${NSD_SetText} $dshDetectText "$R9"
    EnableWindow $dshInstallBtn 1
FunctionEnd

Function dshDetectPageCreate
  Call RunShippedDshDetect
  nsDialogs::Create 1018
  Pop $dshDetectDialog
  ${If} $dshDetectDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 78u "$R9"
  Pop $dshDetectText
  ${NSD_CreateButton} 0 86u 140u 16u "立即安装 dsh"
  Pop $dshInstallBtn
  ${NSD_OnClick} $dshInstallBtn OnInstallDsh
  ${If} $dshDetectStatus == "FOUND"
    EnableWindow $dshInstallBtn 0
  ${EndIf}
  nsDialogs::Show
FunctionEnd
!endif
