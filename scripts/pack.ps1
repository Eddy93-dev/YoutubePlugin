# Zips the extension files for upload to the Chrome Web Store.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$dist = Join-Path $root "dist"
$out = Join-Path $dist "youtube-watched-hider-$version.zip"
$files = "manifest.json", "lib.js", "content.js", "content.css", "background.js", "popup.html", "popup.js", "icons" |
  ForEach-Object { Join-Path $root $_ }

New-Item -ItemType Directory -Force $dist | Out-Null
Compress-Archive -Path $files -DestinationPath $out -Force
Write-Output "Wrote $out"
