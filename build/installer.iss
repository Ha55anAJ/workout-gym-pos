; ============================================================================
;  Demo Gym - Inno Setup installer script
;  Compile with Inno Setup 6 (ISCC.exe build\installer.iss) or via build-windows.bat
;  Produces dist\Demo-Gym-Setup.exe
; ============================================================================
#define AppName "Demo Gym"
#define AppVersion "1.0.0"
#define AppExe "app.exe"
#define AppPublisher "Demo Gym"

[Setup]
AppId={{8E2D4C1A-7B3F-4E59-9A2C-DEMOGYM0001}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; Per-user install: no administrator rights needed (front-desk friendly)
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Demo Gym
DefaultGroupName=Demo Gym
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Demo-Gym-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "autostart"; Description: "Start Demo Gym automatically when Windows starts"; GroupDescription: "Startup:"

[Files]
; Everything the build script placed in dist\ (app.exe, native .node files, run-hidden.vbs)
Source: "..\dist\*"; DestDir: "{app}"; Excludes: "Demo-Gym-Setup.exe"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Demo Gym";            Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall Demo Gym";  Filename: "{uninstallexe}"
Name: "{userdesktop}\Demo Gym";      Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Auto-start at login (per-user). Launches hidden via the VBS, server only (no browser popup).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; \
  ValueName: "DemoGym"; ValueData: "wscript.exe ""{app}\run-hidden.vbs"""; \
  Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch Demo Gym now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
