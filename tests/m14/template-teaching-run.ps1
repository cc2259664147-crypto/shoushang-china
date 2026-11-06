$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$evidence = Join-Path $repo ('docs/qa/evidence/m14-3c-teaching-' + [guid]::NewGuid().ToString('N'))
$data = Join-Path $env:TEMP ('m14-3b-teaching-' + [guid]::NewGuid().ToString('N'))
if ((Test-Path -LiteralPath $evidence) -or (Test-Path -LiteralPath $data)) { throw 'Isolation roots already exist' }
New-Item -ItemType Directory -Path $evidence,$data -ErrorAction Stop | Out-Null
$env:M14_3B_DATA_ROOT = $data
$env:M14_3C_EVIDENCE = $evidence
pnpm exec tsx tests/m14/prepare-templates.ts (Join-Path $data 'content.sqlite')
if ($LASTEXITCODE -ne 0) { throw 'Isolated template preparation failed' }
pnpm exec playwright test --config tests/m14/template-teaching.config.ts
if ($LASTEXITCODE -ne 0) { throw "Teaching browser run failed; evidence preserved at $evidence" }
Write-Output "Evidence: $evidence"
Write-Output "Isolated database: $data"
