param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$m12Root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $m12Root
$m12Evidence = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$m12Allowed = [System.IO.Path]::GetFullPath((Join-Path $m12Root 'docs/api/evidence')) + [System.IO.Path]::DirectorySeparatorChar
if (-not $m12Evidence.StartsWith($m12Allowed) -or (Test-Path -LiteralPath $m12Evidence)) { throw 'Choose a new directory inside docs/api/evidence' }
New-Item -ItemType Directory $m12Evidence | Out-Null
function Invoke-M12Check([string]$Name, [scriptblock]$Command) {
  & $Command 2>&1 | Tee-Object (Join-Path $m12Evidence ($Name + '.txt'))
  if ($LASTEXITCODE -ne 0) { throw ($Name + ' failed: ' + $LASTEXITCODE) }
}
Invoke-M12Check 'typecheck' { pnpm typecheck }
Invoke-M12Check 'test' { pnpm test }
Invoke-M12Check 'build' { pnpm build }
Invoke-M12Check 'm12-specialist' { pnpm exec vitest run apps/api/src/content/content.test.ts packages/content-client/src/http.test.ts }
Invoke-M12Check 'built-runtime' { pnpm exec tsx apps/api/testing/verify-built.ts }
$m12BrowserRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('shoushang-integration-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory $m12BrowserRoot | Out-Null
$env:M12_INTEGRATION_ROOT = $m12BrowserRoot
try {
  Invoke-M12Check 'full-chain-browser' { pnpm exec playwright test --config apps/web/testing/integration/playwright.config.ts }
} finally {
  $m12BrowserEvidence = Join-Path $m12Evidence 'browser'
  New-Item -ItemType Directory -Force $m12BrowserEvidence | Out-Null
  Get-ChildItem -LiteralPath $m12BrowserRoot -File | Where-Object { $_.Extension -in @('.json','.png') } | Copy-Item -Destination $m12BrowserEvidence
  if ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($m12BrowserRoot)) -ne ([System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())).TrimEnd('\','/')) { throw 'Unexpected temporary directory' }
  Remove-Item -LiteralPath $m12BrowserRoot -Recurse -Force
}
& (Join-Path $PSScriptRoot 'run-regressions.ps1') -EvidenceDirectory (Join-Path $m12Evidence 'regressions')
if ($LASTEXITCODE -ne 0) { throw 'Browser regression failed' }
git diff --check 2>&1 | Tee-Object (Join-Path $m12Evidence 'diff-check.txt')
if ($LASTEXITCODE -ne 0) { throw 'Diff whitespace check failed' }
