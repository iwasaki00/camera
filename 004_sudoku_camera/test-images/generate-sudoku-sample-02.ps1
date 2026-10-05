Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot 'sudoku-sample-02.png'
$grid = @(
  8, 0, 5, 0, 1, 0, 0, 0, 7,
  0, 9, 0, 8, 0, 7, 0, 0, 0,
  0, 0, 7, 0, 9, 0, 6, 0, 0,
  5, 0, 0, 0, 3, 0, 0, 0, 2,
  1, 0, 3, 0, 7, 0, 5, 0, 9,
  7, 0, 0, 0, 2, 0, 0, 0, 3,
  0, 0, 2, 0, 8, 0, 3, 0, 0,
  0, 8, 0, 3, 0, 5, 0, 0, 0,
  3, 0, 0, 0, 6, 0, 0, 0, 5
)

$bitmap = [System.Drawing.Bitmap]::new(900, 900)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$thinPen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 3)
$thickPen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 8)
$font = [System.Drawing.Font]::new('Arial', 52, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
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
    $verticalOffset = if (($row + $column) % 2 -eq 0) { -1 } else { 1 }
    $bounds = [System.Drawing.RectangleF]::new($column * 100, $row * 100 + $verticalOffset, 100, 100)
    $graphics.DrawString([string]$grid[$index], $font, [System.Drawing.Brushes]::Black, $bounds, $format)
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
