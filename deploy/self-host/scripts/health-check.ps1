param(
  [Parameter(Mandatory = $true)][string]$AppUrl,
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [string]$StudioUrl
)

$ErrorActionPreference = 'Stop'

function Test-Url([string]$Name, [string]$Url) {
  $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec 15
  Write-Output "$Name $($response.StatusCode) $Url"
}

Test-Url "app" $AppUrl
Test-Url "api" "$ApiUrl/auth/v1/health"

if ($StudioUrl) {
  Test-Url "studio" $StudioUrl
}
