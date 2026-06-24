' Launches Demo Gym (app.exe) in the background with no console window and
' without opening a browser. Used for "start automatically when Windows starts".
Dim sh, fso, here
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' 0 = hidden window, False = do not wait
sh.Run """" & here & "\app.exe"" --no-open", 0, False
