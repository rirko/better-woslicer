$ErrorActionPreference = 'Stop'

$package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$executable = "src-tauri/target/$env:RUST_TARGET/release/$($package.name).exe"
if ((Get-Item -LiteralPath $executable).Length -eq 0) { throw "Empty executable: $executable" }

$destination = "release/$env:RELEASE_PLATFORM"
$archive = "$destination/$($package.name)-$($package.version)-$env:RELEASE_PLATFORM-portable.zip"
$files = @($executable, 'LICENSE', 'NOTICE')
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force

$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archive).Path)
try {
  if ($zip.Entries.Count -ne $files.Count) { throw "Unexpected entry count in $archive" }
  foreach ($file in $files) {
    $name = Split-Path -Leaf $file
    $entry = $zip.GetEntry($name)
    if ($null -eq $entry) { throw "Missing $name in $archive" }
    $stream = $entry.Open()
    try {
      $expected = (Get-FileHash -LiteralPath $file).Hash
      $actual = (Get-FileHash -InputStream $stream).Hash
      if ($actual -ne $expected) { throw "Archive entry differs from source: $name" }
    } finally {
      $stream.Dispose()
    }
  }
} finally {
  $zip.Dispose()
}
Write-Output "Verified $archive"
