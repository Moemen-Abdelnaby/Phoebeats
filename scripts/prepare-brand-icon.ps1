# Pad the project-owned artwork to a square without cropping or stretching it.
Add-Type -AssemblyName System.Drawing
$projectDir = Split-Path -Parent $PSScriptRoot
$source = [System.Drawing.Image]::FromFile((Join-Path $projectDir 'src/assets/brand.png'))
try {
  $size = [Math]::Max($source.Width, $source.Height)
  $canvas = New-Object System.Drawing.Bitmap($size, $size)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.DrawImageUnscaled($source, [int](($size - $source.Width) / 2), [int](($size - $source.Height) / 2))
    } finally { $graphics.Dispose() }
    $canvas.Save((Join-Path $projectDir 'src/assets/brand-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $canvas.Dispose() }
} finally { $source.Dispose() }
