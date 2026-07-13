param(
  [int]$Bytes = 48,
  [int]$Years = 10
)

function New-Secret([int]$Length) {
  $buffer = [byte[]]::new($Length)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-Jwt([string]$Secret, [string]$Role, [int]$YearsToLive) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $exp = [DateTimeOffset]::UtcNow.AddYears($YearsToLive).ToUnixTimeSeconds()
  $header = @{ alg = 'HS256'; typ = 'JWT' } | ConvertTo-Json -Compress
  $payload = @{ role = $Role; iss = 'supabase'; iat = $now; exp = $exp } | ConvertTo-Json -Compress
  $headerPart = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))
  $payloadPart = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($payload))
  $body = "$headerPart.$payloadPart"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Secret))
  $signature = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))
  "$body.$signature"
}

$jwtSecret = New-Secret 64

Write-Output "POSTGRES_PASSWORD=$(New-Secret $Bytes)"
Write-Output "JWT_SECRET=$jwtSecret"
Write-Output "ANON_KEY=$(New-Jwt $jwtSecret 'anon' $Years)"
Write-Output "SERVICE_ROLE_KEY=$(New-Jwt $jwtSecret 'service_role' $Years)"
Write-Output "DASHBOARD_PASSWORD=$(New-Secret $Bytes)"
Write-Output ""
Write-Output "Do not paste generated secrets into chat, screenshots, Git, or shell history."
