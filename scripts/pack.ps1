# Zips the extension for release: everything at the repo root except development files,
# so new extension files are included without editing this list.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$dist = Join-Path $root "dist"
$out = Join-Path $dist "youtube-watched-hider-$version.zip"
$devOnly = ".git", ".github", ".gitattributes", ".gitignore", ".playwright-mcp", "dist", "docs", "node_modules",
  "scripts", "test", "package.json", "package-lock.json"
$files = Get-ChildItem -Path $root -Force |
  Where-Object { $devOnly -notcontains $_.Name -and $_.Extension -ne ".md" } |
  ForEach-Object { $_.FullName }

New-Item -ItemType Directory -Force $dist | Out-Null
Compress-Archive -Path $files -DestinationPath $out -Force
Write-Output "Wrote $out"
