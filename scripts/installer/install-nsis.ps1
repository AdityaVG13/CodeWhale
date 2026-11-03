$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'RUNNER_TEMP is required to provision NSIS.'
}

$version = '3.13'
$sha256 = 'DB9A1038BBC0E53FEF24F423FD609979BD578E942F1BE1198DB186D1C42652A3'
$installer = Join-Path $env:RUNNER_TEMP "nsis-$version-setup.exe"
$url = "https://sourceforge.net/projects/nsis/files/NSIS%203/$version/nsis-$version-setup.exe/download"

try {
    & curl.exe --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 60 --retry 2 --retry-delay 5 --output $installer $url
    if ($LASTEXITCODE -ne 0) { throw "NSIS download failed with exit code $LASTEXITCODE." }
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $sha256) {
        throw 'NSIS installer checksum mismatch.'
    }

    $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "NSIS setup failed with exit code $($process.ExitCode)." }
    $makensis = @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe") |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (!$makensis) { throw 'makensis.exe was not found after NSIS setup.' }
    $installedVersion = (& $makensis '/VERSION').Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne "v$version") {
        throw "Expected NSIS v$version, found $installedVersion."
    }
    Write-Host "NSIS $version verified at $makensis"
} finally {
    Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}
