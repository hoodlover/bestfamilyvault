param(
  [string]$Sheets = "",
  [string]$Output = "",
  [int]$Size = 128,
  [string]$Pattern = "sheet[1-8].png",
  [switch]$KeepExisting
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot

if ($Sheets -eq "") {
  $Sheets = Join-Path $ProjectRoot "public\icons\cobb\icon-sheets"
}

if ($Output -eq "") {
  $Output = Join-Path $ProjectRoot "public\icons\cobb\sliced-icons"
}

$Processor = Join-Path $PSScriptRoot "process-icons.py"

New-Item -ItemType Directory -Force -Path $Output | Out-Null

if (-not $KeepExisting) {
  Get-ChildItem -Path $Output -File -Filter "*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
  $SplitFolder = Join-Path $Output "_split"
  if (Test-Path $SplitFolder) {
    Remove-Item -Recurse -Force $SplitFolder
  }
}

python $Processor `
  --sheets $Sheets `
  --pattern $Pattern `
  --output $Output `
  --size $Size `
  --padding 4 `
  --detect-min-size 220 `
  --detect-max-size 360 `
  --detect-min-area 20000 `
  --crop-padding 8 `
  --force-square `
  --use-label-names
