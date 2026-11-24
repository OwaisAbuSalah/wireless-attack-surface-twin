# Renders the deck with Microsoft PowerPoint: PNG per slide (QA) and a PDF copy.
#   powershell -ExecutionPolicy Bypass -File export_pptx.ps1 [-Png <dir>] [-Pdf]
param([string]$Deck = "$PSScriptRoot\Wireless_Attack_Surface_Digital_Twin.pptx", [string]$Png = "", [switch]$Pdf)
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $p = $app.Presentations.Open((Resolve-Path $Deck).Path, $true, $false, $false)   # read-only, no window
  if ($Png) {
    New-Item -ItemType Directory -Force $Png | Out-Null
    foreach ($s in $p.Slides) { $s.Export((Join-Path $Png ("slide-{0:D2}.png" -f $s.SlideIndex)), 'PNG', 1600, 900) }
    "exported $($p.Slides.Count) slides to $Png"
  }
  if ($Pdf) {
    $out = [IO.Path]::ChangeExtension((Resolve-Path $Deck).Path, '.pdf')
    $p.SaveAs($out, 32)   # ppSaveAsPDF
    "pdf: $out"
  }
  $p.Close()
} finally { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
