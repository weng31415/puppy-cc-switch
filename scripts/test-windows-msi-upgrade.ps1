param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][ValidateSet('X64', 'ARM64')][string]$Architecture
)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'This installation test needs a disposable GitHub-hosted Windows runner.'
}
$programs = Join-Path $env:LOCALAPPDATA 'Programs'
$appDir = Join-Path $programs 'puppyrouter app'
if (Test-Path $appDir) { throw "The test needs a clean profile: $appDir already exists." }

# The previous production MSI contains the uninstall rule exercised by this regression test.
$baseline = 'https://pub-46dbf53707f84a02979c772ef87254ab.r2.dev/downloads/PuppyRouter-App-v3.19.5-69a9633-Windows'
if ($Architecture -eq 'ARM64') {
  $baseline += '-arm64'
  $expected = 'c4b0017aa8ce81823d183f2b5def7f7dfbf6974fde96bdf55d53719940756906'
} else {
  $expected = '481f9ed1dfd58b25db70201c5820cc45c7be27b6e0eb892ea204cffc64965cc0'
}
$previous = Join-Path $env:RUNNER_TEMP 'puppyrouter-3.19.5.msi'
Invoke-WebRequest "$baseline.msi" -OutFile $previous
if ((Get-FileHash $previous).Hash -ne $expected) { throw 'Previous MSI checksum mismatch.' }
$current = (Resolve-Path $Installer).Path
$executable = Join-Path $appDir 'puppyrouter-app.exe'
$license = Join-Path $appDir 'LICENSE.txt'
$sentinel = Join-Path $programs ("puppyrouter-test-{0}.txt" -f [guid]::NewGuid())

function Invoke-Msi([string]$Operation, [string]$Path, [string]$Step) {
  $log = Join-Path $env:RUNNER_TEMP "puppyrouter-$Step.log"
  $process = Start-Process msiexec.exe -ArgumentList "$Operation `"$Path`" /qn /norestart /l*v `"$log`"" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Select-String -Path $log -Pattern 'Return value 3' -Context 8,0 | Out-Host
    throw "$Step failed with MSI exit code $($process.ExitCode)"
  }
}

Invoke-Msi '/i' $previous 'install-previous'
if (!(Test-Path $executable)) { throw 'Previous MSI did not install the executable.' }
try {
  Set-Content -LiteralPath $sentinel -Value 'unrelated file'
  Invoke-Msi '/i' $current 'upgrade'
  if (!(Test-Path $sentinel)) { throw 'Upgrade removed a file in the shared Programs folder.' }
  if (!(Test-Path $executable)) { throw 'Upgrade removed the application executable.' }
  if ((Get-FileHash $license).Hash -ne (Get-FileHash LICENSE).Hash) { throw 'Installed license mismatch.' }
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $installedVersion = (Get-Item $executable).VersionInfo.ProductVersion
  if ($installedVersion -notin @($version, "$version.0")) { throw "Unexpected installed version $installedVersion." }
  Invoke-Msi '/x' $current 'uninstall'
  if ((Test-Path $license) -or (Test-Path $executable)) { throw 'Uninstall left application files behind.' }
  if (!(Test-Path $sentinel)) { throw 'Uninstall removed a file in the shared Programs folder.' }
} finally {
  Remove-Item -LiteralPath $sentinel -ErrorAction SilentlyContinue
}
