[CmdletBinding()]
param(
  [ValidateSet('Generate', 'Verify')]
  [string]$Mode = 'Verify',
  [string]$BaselinePath = 'docs/qa/m15/final6-baseline.tsv',
  [string]$SidecarPath = 'docs/qa/m15/final6-baseline.sha256',
  [string]$RootOverride
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$frozenRelativeRoot = 'delivery/v1-initial-20261023-final6'
$defaultRoot = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot $frozenRelativeRoot)).Path
$root = if ($RootOverride) { (Resolve-Path -LiteralPath $RootOverride).Path } else { $defaultRoot }

if ($Mode -eq 'Generate' -and $root -ne $defaultRoot) {
  throw 'Generate mode only accepts the fixed final6 root.'
}

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([Convert]::ToHexString($sha.ComputeHash($Bytes))).ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-TreeSnapshot([string]$TreeRoot) {
  $entries = [System.Collections.Generic.List[object]]::new()
  Get-ChildItem -LiteralPath $TreeRoot -File -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($TreeRoot.Length + 1).Replace('\', '/')
    $entries.Add([pscustomobject]@{
      RelativePath = $relative
      FileLength = [long]$_.Length
      Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    })
  }
  $items = $entries.ToArray()
  [Array]::Sort($items, [System.Collections.Generic.Comparer[object]]::Create(
    [System.Comparison[object]]{ param($a, $b) [StringComparer]::Ordinal.Compare($a.RelativePath, $b.RelativePath) }
  ))
  $manifest = (($items | ForEach-Object { "$($_.RelativePath)`t$($_.FileLength)`t$($_.Sha256)" }) -join "`n") + "`n"
  $utf8 = [Text.UTF8Encoding]::new($false)
  $bytes = $utf8.GetBytes($manifest)
  [pscustomobject]@{
    Items = $items
    Manifest = $manifest
    Bytes = $bytes
    Files = $items.Count
    TotalBytes = [long](($items | Measure-Object -Property FileLength -Sum).Sum)
    ManifestSha256 = Get-Sha256Hex $bytes
  }
}

function Resolve-OutputPath([string]$Path) {
  if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
  return [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path))
}

function Test-IsWithinPath([string]$Candidate, [string]$Directory) {
  $normalizedCandidate = [IO.Path]::GetFullPath($Candidate)
  $normalizedDirectory = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Directory))
  return [string]::Equals($normalizedCandidate, $normalizedDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedCandidate.StartsWith($normalizedDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Read-BaselineEntries([string]$Text) {
  $entries = [System.Collections.Generic.List[object]]::new()
  foreach ($line in $Text.Split("`n", [StringSplitOptions]::RemoveEmptyEntries)) {
    $parts = $line.Split("`t")
    if ($parts.Count -ne 3 -or $parts[1] -notmatch '^\d+$' -or $parts[2] -notmatch '^[0-9a-f]{64}$') {
      throw "Invalid baseline line: $line"
    }
    $entries.Add([pscustomobject]@{ RelativePath = $parts[0]; FileLength = [long]$parts[1]; Sha256 = $parts[2] })
  }
  return $entries.ToArray()
}

function Show-FirstDifference([object[]]$Expected, [object[]]$Actual) {
  $expectedByPath = @{}
  $actualByPath = @{}
  foreach ($item in $Expected) { $expectedByPath[$item.RelativePath] = $item }
  foreach ($item in $Actual) { $actualByPath[$item.RelativePath] = $item }
  $paths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($path in $expectedByPath.Keys) { [void]$paths.Add($path) }
  foreach ($path in $actualByPath.Keys) { [void]$paths.Add($path) }
  [string[]]$ordered = @($paths)
  [Array]::Sort($ordered, [StringComparer]::Ordinal)
  foreach ($path in $ordered) {
    $expected = $expectedByPath[$path]
    $actual = $actualByPath[$path]
    $expectedByteLength = if ($null -eq $expected) { $null } else { $expected.FileLength }
    $actualByteLength = if ($null -eq $actual) { $null } else { $actual.FileLength }
    if ($null -eq $expected -or $null -eq $actual -or $expectedByteLength -ne $actualByteLength -or $expected.Sha256 -ne $actual.Sha256) {
      $expectedLength = if ($null -eq $expected) { '<missing>' } else { [string]$expectedByteLength }
      $expectedHash = if ($null -eq $expected) { '<missing>' } else { $expected.Sha256 }
      $actualLength = if ($null -eq $actual) { '<missing>' } else { [string]$actualByteLength }
      $actualHash = if ($null -eq $actual) { '<missing>' } else { $actual.Sha256 }
      [Console]::Error.WriteLine("firstDifference=$path")
      [Console]::Error.WriteLine("expectedLength=$expectedLength actualLength=$actualLength")
      [Console]::Error.WriteLine("expectedSha256=$expectedHash actualSha256=$actualHash")
      return
    }
  }
  [Console]::Error.WriteLine('firstDifference=<manifest-metadata>')
}

$baselineFullPath = Resolve-OutputPath $BaselinePath
$sidecarFullPath = Resolve-OutputPath $SidecarPath
$approvedBaselinePath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'docs/qa/m15/final6-baseline.tsv'))
$approvedSidecarPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'docs/qa/m15/final6-baseline.sha256'))

if ([string]::Equals($baselineFullPath, $sidecarFullPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Baseline and sidecar output paths must be different.'
}
if ($Mode -eq 'Generate') {
  if ((Test-IsWithinPath $baselineFullPath $defaultRoot) -or (Test-IsWithinPath $sidecarFullPath $defaultRoot)) {
    throw 'Generate mode refuses every output path inside the frozen final6 tree.'
  }
  if (![string]::Equals($baselineFullPath, $approvedBaselinePath, [StringComparison]::OrdinalIgnoreCase) -or
      ![string]::Equals($sidecarFullPath, $approvedSidecarPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Generate mode only writes docs/qa/m15/final6-baseline.tsv and docs/qa/m15/final6-baseline.sha256.'
  }
}

$snapshot = Get-TreeSnapshot $root
$utf8 = [Text.UTF8Encoding]::new($false)

if ($Mode -eq 'Generate') {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($baselineFullPath)) | Out-Null
  [IO.File]::WriteAllBytes($baselineFullPath, $snapshot.Bytes)
  $sidecar = [ordered]@{
    formatVersion = 1
    root = $frozenRelativeRoot
    files = $snapshot.Files
    bytes = $snapshot.TotalBytes
    manifestSha256 = $snapshot.ManifestSha256
    pathOrdering = 'System.StringComparer.Ordinal'
    encoding = 'UTF-8 without BOM'
    lineEnding = 'LF with trailing LF'
    generatedAt = '2026-10-23 (baseline preparation; excluded from manifest hash)'
  }
  $sidecarText = ((($sidecar | ConvertTo-Json -Depth 3) -replace "`r`n", "`n") -replace "`r", "`n") + "`n"
  [IO.File]::WriteAllText($sidecarFullPath, $sidecarText, $utf8)
} else {
  if (!(Test-Path -LiteralPath $baselineFullPath) -or !(Test-Path -LiteralPath $sidecarFullPath)) {
    throw 'Baseline TSV or sidecar is missing; verify mode never generates or updates it.'
  }
  $expectedBytes = [IO.File]::ReadAllBytes($baselineFullPath)
  $expectedText = $utf8.GetString($expectedBytes)
  if (!$expectedText.EndsWith("`n") -or $expectedText.Contains("`r")) { throw 'Baseline must use LF with a trailing LF.' }
  $expectedEntries = Read-BaselineEntries $expectedText
  $metadata = Get-Content -LiteralPath $sidecarFullPath -Raw | ConvertFrom-Json
  $expectedManifestHash = Get-Sha256Hex $expectedBytes
  $sameBytes = [Linq.Enumerable]::SequenceEqual([byte[]]$expectedBytes, [byte[]]$snapshot.Bytes)
  $metadataMatches = $metadata.formatVersion -eq 1 -and
    $metadata.root -eq $frozenRelativeRoot -and
    $metadata.files -eq $snapshot.Files -and
    $metadata.bytes -eq $snapshot.TotalBytes -and
    $metadata.manifestSha256 -eq $snapshot.ManifestSha256 -and
    $metadata.manifestSha256 -eq $expectedManifestHash
  if (!$sameBytes -or !$metadataMatches) {
    Show-FirstDifference $expectedEntries $snapshot.Items
    [Console]::Error.WriteLine("expectedManifestSha256=$($metadata.manifestSha256) actualManifestSha256=$($snapshot.ManifestSha256)")
    exit 1
  }
}

Write-Output "files=$($snapshot.Files)"
Write-Output "bytes=$($snapshot.TotalBytes)"
Write-Output "manifestSha256=$($snapshot.ManifestSha256)"
