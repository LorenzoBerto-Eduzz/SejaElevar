Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)

If shell.Run("cmd /c node --version", 0, True) <> 0 Then
  MsgBox "Node.js nao foi encontrado. Instale Node.js LTS para abrir o SejaElevar.", 48, "SejaElevar"
  WScript.Quit 1
End If

shell.CurrentDirectory = folder
shell.Run "node server.mjs", 0, False
