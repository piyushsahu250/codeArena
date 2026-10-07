<#
  Provision one college-lab PC for CodeArena LOCKDOWN exams. Run in an ELEVATED PowerShell on the PC, once, after installing the
  CodeArena Secure Exam Client (installer puts it in "C:\Program Files\CodeArena Secure Exam").

  Prerequisite: register the device in CodeArena (Admin > Secure exam devices). The page shows the deviceId and the device secret
  ONCE. Pass them here. Nothing in this script contacts the internet.

  Usage:
    .\Provision-ExamPC.ps1 -DeviceId LAB3-PC14 -DeviceSecret <secret> -InvigilatorPinHash "<salt>:<hash>" `
        -AppUrl https://codearena.site -ApiUrl https://api-aws.codearena.site/api
#>
param(
  [Parameter(Mandatory)] [string] $DeviceId,
  [Parameter(Mandatory)] [string] $DeviceSecret,
  [Parameter(Mandatory)] [string] $InvigilatorPinHash,   # output of: node tools/make-pin.js <pin>
  [string] $AppUrl = "https://codearena.site",
  [string] $ApiUrl = "https://api-aws.codearena.site/api",
  [string] $ExamUser = "ExamStudent",
  [switch] $ApplyAssignedAccess,
  [switch] $ApplyAppLocker
)
$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run as Administrator" }

$kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = "C:\Program Files\CodeArena Secure Exam\CodeArena Secure Exam.exe"
if (-not (Test-Path $exe)) { throw "Install the CodeArena Secure Exam Client first ($exe not found)" }

# 1. protected configuration: only SYSTEM and Administrators can read it (students run as a standard user)
$dir = Join-Path $env:ProgramData "CodeArenaSecureExam"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cfg = [ordered]@{
  appUrl = $AppUrl; apiUrl = $ApiUrl; deviceId = $DeviceId; deviceSecret = $DeviceSecret
  allowedHosts = @(([uri]$AppUrl).Host, ([uri]$ApiUrl).Host, "fonts.googleapis.com", "fonts.gstatic.com", "storage.googleapis.com", "tfhub.dev", "www.kaggle.com")
  networkAttest = "client"; killBlockedProcesses = $false; invigilatorPinHash = $InvigilatorPinHash
}
$cfgPath = Join-Path $dir "config.json"
$cfg | ConvertTo-Json -Depth 4 | Set-Content -Path $cfgPath -Encoding UTF8
# Secret handling: only SYSTEM, Administrators and the dedicated exam account can read the config. The exam account is a standard
# user confined to the kiosk app (no shell, no file browser, application allow-list), so the student has no way to open the file.
# This is the residual trust in a managed lab; on an unmanaged PC an administrator could read it (hence LOCKDOWN = managed devices).
icacls $dir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
icacls $cfgPath /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" | Out-Null
# 2. dedicated standard (non-admin) exam account
if (-not (Get-LocalUser -Name $ExamUser -ErrorAction SilentlyContinue)) {
  $pw = ConvertTo-SecureString ([Guid]::NewGuid().ToString("N") + "Aa1!") -AsPlainText -Force
  New-LocalUser -Name $ExamUser -Password $pw -PasswordNeverExpires -UserMayNotChangePassword -Description "CodeArena exam account (kiosk)" | Out-Null
  Add-LocalGroupMember -Group "Users" -Member $ExamUser
}

icacls $cfgPath /grant "${ExamUser}:R" | Out-Null

# 3. kiosk (free, built in)
if ($ApplyAssignedAccess) {
  $ns = "root\cimv2\mdm\dmmap"; $cls = "MDM_AssignedAccess"
  $obj = Get-CimInstance -Namespace $ns -ClassName $cls
  $obj.Configuration = [System.Net.WebUtility]::HtmlEncode((Get-Content -Raw (Join-Path $kit "AssignedAccess-ExamKiosk.xml")))
  Set-CimInstance -CimInstance $obj
  Write-Host "Assigned Access applied for $ExamUser"
}

# 4. application allow-list (Enterprise/Education)
if ($ApplyAppLocker) {
  Set-Service -Name AppIDSvc -StartupType Automatic; Start-Service AppIDSvc
  Set-AppLockerPolicy -XmlPolicy (Join-Path $kit "AppLocker-ExamPolicy.xml")
  Write-Host "AppLocker policy applied"
}

# 5. browser policy for any browser left on the machine (belt and braces)
reg import (Join-Path $kit "Edge-Chrome-ManagedPolicy.reg") | Out-Null

Write-Host "Provisioned $DeviceId. Next: reboot, sign in as $ExamUser, run the device health check from the exam page."
