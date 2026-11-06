param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$m12RegressionRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $m12RegressionRoot
$m12Evidence = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$m12AllowedEvidence = [System.IO.Path]::GetFullPath((Join-Path $m12RegressionRoot 'docs/api/evidence')) + [System.IO.Path]::DirectorySeparatorChar
if (-not $m12Evidence.StartsWith($m12AllowedEvidence)) { throw 'Evidence must be inside docs/api/evidence' }
if (Test-Path -LiteralPath $m12Evidence) { throw 'Choose a new evidence directory' }
New-Item -ItemType Directory -Path $m12Evidence | Out-Null
$env:M12_EVIDENCE_RUN = $m12Evidence
$m12Preload = (Join-Path $PSScriptRoot 'preserve-evidence.cjs').Replace('\','/')
$env:NODE_OPTIONS = '--require=' + $m12Preload
$m12Suites = @(
  @{name='m11';config='apps/web/src/features/home/playwright.config.ts';extra=@()},
  @{name='m10';config='apps/web/src/features/gallery/playwright.config.ts';extra=@()},
  @{name='m09';config='apps/web/src/features/my-works/playwright.config.ts';extra=@()},
  @{name='m07-m08';config='apps/web/src/features/workshop/playwright.config.ts';extra=@('workshop.spec.ts','work-card-export.m08.spec.ts')}
)
foreach ($m12Suite in $m12Suites) {
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $m12Evidence ($m12Suite.name + '-report.json')
  $m12Extra = $m12Suite.extra
  pnpm exec playwright test --config $m12Suite.config --reporter=list,json --output (Join-Path $m12Evidence ($m12Suite.name + '-results')) @m12Extra 2>&1 | Tee-Object (Join-Path $m12Evidence ($m12Suite.name + '.txt'))
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $m12Evidence 'm05-report.json'
pnpm --filter @shoushang/storage-verification typecheck 2>&1 | Tee-Object (Join-Path $m12Evidence 'm05-typecheck.txt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm --filter @shoushang/storage-verification exec playwright test --config playwright.config.ts --reporter=list,json --output (Join-Path $m12Evidence 'm05-results') 2>&1 | Tee-Object (Join-Path $m12Evidence 'm05.txt')
exit $LASTEXITCODE
