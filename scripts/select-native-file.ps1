param([string]$Title,[string]$File)
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class FileDialogControl {
 public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int max);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h,string text);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h,int id);
 public static List<IntPtr> Edits(IntPtr h) {var result=new List<IntPtr>();EnumChildWindows(h,(c,p)=>{var cls=new StringBuilder(128);GetClassName(c,cls,128);if(cls.ToString()=="Edit") {Console.WriteLine("Edit control ID "+GetDlgCtrlID(c));if(GetDlgCtrlID(c)==1001 || GetDlgCtrlID(c)==1148)result.Add(c);}return true;},IntPtr.Zero);return result;}
}
'@
$dialogHandle=[FileDialogControl]::FindWindow('#32770',$Title)
if ($dialogHandle -eq [IntPtr]::Zero) { throw 'Target file dialog not found' }
$edits=[FileDialogControl]::Edits($dialogHandle)
if ($edits.Count -ne 1) { throw 'File name field was not uniquely identified' }
Add-Type -AssemblyName System.Windows.Forms
[FileDialogControl]::SetForegroundWindow($dialogHandle) | Out-Null
[System.Windows.Forms.SendKeys]::SendWait('%n')
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait($File)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
