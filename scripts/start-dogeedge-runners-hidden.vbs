Option Explicit

Dim shell
Dim fileSystem
Dim scriptDir
Dim repoRoot
Dim runnerPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fileSystem.GetParentFolderName(scriptDir)
runnerPath = fileSystem.BuildPath(scriptDir, "start-dogeedge-runners.ps1")

command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & runnerPath & Chr(34)
shell.CurrentDirectory = repoRoot
shell.Run command, 0, False
