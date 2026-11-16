Option Explicit

Dim fso, shell, scriptDir, watchScript, nodeExe, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
watchScript = fso.BuildPath(scriptDir, "watch-sync.mjs")

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then
    nodeExe = "node"
End If

cmd = """" & nodeExe & """ """ & watchScript & """"
shell.CurrentDirectory = scriptDir
shell.Run cmd, 0, False
