param([string]$EvidenceRoot)
$ErrorActionPreference = 'Stop'
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path (Get-Location) ('docs/qa/evidence/m14-3b-browser-' + [guid]::NewGuid().ToString('N')) }
if (Test-Path -LiteralPath $EvidenceRoot) { throw 'Evidence root must not already exist' }
$dataRoot = Join-Path $env:TEMP ('m14-3b-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dataRoot -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $EvidenceRoot -ErrorAction Stop | Out-Null
$env:M14_3B_DATA_ROOT = (Resolve-Path -LiteralPath $dataRoot).Path
$env:M14_3B_EVIDENCE = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$dbPath = Join-Path $env:M14_3B_DATA_ROOT 'content.sqlite'
pnpm exec tsx tests/m14/prepare-templates.ts $dbPath
if ($LASTEXITCODE -ne 0) { throw 'Candidate database initialization failed' }
pnpm exec playwright test --config tests/m14/template-browser.config.ts
if ($LASTEXITCODE -ne 0) { throw 'Candidate browser integration failed; isolated data and evidence retained' }
Write-Output "Evidence: $env:M14_3B_EVIDENCE"
Write-Output "Isolated data: $env:M14_3B_DATA_ROOT"
