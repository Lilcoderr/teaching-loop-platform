param(
  [string]$ComposeDir = "/opt/teaching-loop/supabase",
  [string]$OutputDir = "/opt/teaching-loop/backups/postgres"
)

$ErrorActionPreference = 'Stop'

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $OutputDir "postgres-$timestamp.sql"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Push-Location $ComposeDir
try {
  docker compose exec -T db pg_dumpall -U postgres | Out-File -Encoding utf8 $backupFile
}
finally {
  Pop-Location
}

Write-Output $backupFile
