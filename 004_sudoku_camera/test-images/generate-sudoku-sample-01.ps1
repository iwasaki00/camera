Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot 'sudoku-sample-01.png'
$grid = @(
  1, 2, 0, 0, 5, 0, 0, 0, 0,
  4, 0, 0, 7, 8, 9, 0, 0, 0,
  0, 8, 9, 0, 0, 0, 0, 5, 0,
  2, 0, 0, 0, 6, 0, 0, 0, 1,
  5, 0, 0, 8, 0, 1, 0, 0, 4,
  8, 0, 0, 0, 3, 0, 0, 0, 7,
  0, 4, 0, 0, 0, 0, 9, 1, 0,
  0, 0, 0, 9, 1, 2, 0, 0, 5,
  0, 0, 0, 0, 4, 0, 0, 7, 8
)

$bitmap = [System.Drawing.Bitmap]::new(900, 900)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$thinPen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 3)
$thickPen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 8)
$font = [System.Drawing.Font]::new('Arial', 58, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.Brushes]::Black
$format = [System.Drawing.StringFormat]::new()

try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  for ($line = 0; $line -le 9; $line += 1) {
    $position = if ($line -eq 9) { 896 } elseif ($line -eq 0) { 4 } else { $line * 100 }
    $pen = if (($line % 3) -eq 0) { $thickPen } else { $thinPen }
    $graphics.DrawLine($pen, $position, 0, $position, 900)
    $graphics.DrawLine($pen, 0, $position, 900, $position)
  }

  for ($index = 0; $index -lt 81; $index += 1) {
    if ($grid[$index] -eq 0) { continue }
    $row = [Math]::Floor($index / 9)
    $column = $index % 9
    $bounds = [System.Drawing.RectangleF]::new($column * 100, $row * 100 - 2, 100, 100)
    $graphics.DrawString([string]$grid[$index], $font, $brush, $bounds, $format)
  }

  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $format.Dispose()
  $font.Dispose()
  $thinPen.Dispose()
  $thickPen.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output $outputPath
