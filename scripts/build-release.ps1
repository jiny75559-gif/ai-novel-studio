param(
  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../release'),
  [string]$Repository = 'jiny75559-gif/ai-novel-studio',
  [string]$SigningKey = (Join-Path $env:LOCALAPPDATA 'NovelStudioPublisher/updates.key')
)
$ErrorActionPreference = 'Stop'
$repoDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = [IO.Path]::GetFullPath($ReleaseDirectory)
$version = (Get-Content -LiteralPath (Join-Path $repoDir 'package.json') -Raw | ConvertFrom-Json).version
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid GitHub repository' }
if (-not (Test-Path -LiteralPath $SigningKey)) { throw 'Publisher signing key is missing; never create a replacement key for existing users.' }
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
Push-Location $repoDir
try {
  npm run package
  if ($LASTEXITCODE -ne 0) { throw 'Offline installer build failed' }
  $installer = Join-Path $repoDir "src-tauri/target/release/bundle/nsis/AI Novel Studio_${version}_x64-setup.exe"
  $offline = Join-Path $releaseDir "AI-Novel-Studio-$version-Setup.exe"
  Copy-Item -LiteralPath $installer -Destination $offline
  if ((Get-Item -LiteralPath $offline).Length -lt 150000000) { throw 'Offline runtime not bundled' }
  npm run tauri -- build --bundles nsis --config src-tauri/tauri.update.conf.json
  if ($LASTEXITCODE -ne 0) { throw 'Small updater installer build failed' }
  $smallName = "AI-Novel-Studio-$version-Update.exe"
  $small = Join-Path $releaseDir $smallName
  Copy-Item -LiteralPath $installer -Destination $small
  Copy-Item -LiteralPath (Join-Path $repoDir 'src-tauri/target/release/novel-studio.exe') -Destination (Join-Path $releaseDir 'novel-studio.exe')
  if ((Get-Item -LiteralPath $small).Length -gt 120MB) { throw 'Update unexpectedly includes offline runtime' }
  $manifest = [ordered]@{
    format = 'novel-studio-update-v1'; version = $version; platform = 'windows-x86_64'; repository = $Repository
    url = "https://github.com/$Repository/releases/download/v$version/$smallName"
    sha256 = (Get-FileHash -LiteralPath $small -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $small).Length
    notes = '改进生成预算与超时提醒；增加 HTML、FB2、RTF、ODT、CBZ 阅读；支持签名校验的一键在线与本地更新。'
  }
  $manifestPath = Join-Path $releaseDir 'update-manifest.json'
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Compress), $utf8)
  node node_modules/@tauri-apps/cli/tauri.js signer sign -f $SigningKey --app-version $version $manifestPath
  if ($LASTEXITCODE -ne 0) { throw 'Update manifest signing failed' }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $localPackage = Join-Path $releaseDir "AI-Novel-Studio-$version.nsupdate"
  if (Test-Path -LiteralPath $localPackage) { Remove-Item -LiteralPath $localPackage }
  $archive = [IO.Compression.ZipFile]::Open($localPackage, [IO.Compression.ZipArchiveMode]::Create)
  try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $manifestPath, 'manifest.json') | Out-Null
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, "$manifestPath.sig", 'manifest.sig') | Out-Null
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $small, 'update.exe') | Out-Null
  } finally { $archive.Dispose() }
  [PSCustomObject]@{ Version=$version; Offline=$offline; Update=$small; LocalPackage=$localPackage; SizeMB=[math]::Round((Get-Item -LiteralPath $small).Length/1MB,1) } | ConvertTo-Json
} finally { Pop-Location }
