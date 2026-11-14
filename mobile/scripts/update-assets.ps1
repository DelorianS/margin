# Rasterize the existing Marginalia favicon geometry for Apple's icon catalog.
# No generated artwork or new logo is introduced.
Add-Type -AssemblyName System.Drawing
$mobileRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetRoot = Join-Path $mobileRoot 'ios\App\App\Assets.xcassets'

function Draw-Mark($graphics, [single]$left, [single]$top, [single]$scale) {
    $dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#2B2621'))
    $light = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F7F3EC'))
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#C8633F'))
    $graphics.FillRectangle($dark, $left, $top, 64 * $scale, 64 * $scale)
    $coordinates = @(18,46, 18,18, 22,18, 32,33, 42,18, 46,18, 46,46, 41,46, 41,27, 32,40, 23,27, 23,46)
    $points = [System.Drawing.PointF[]]::new($coordinates.Length / 2)
    for ($i = 0; $i -lt $points.Length; $i++) {
        $points[$i] = [System.Drawing.PointF]::new($left + $coordinates[$i * 2] * $scale, $top + $coordinates[$i * 2 + 1] * $scale)
    }
    $graphics.FillPolygon($light, $points)
    $graphics.FillEllipse($accent, $left + 44 * $scale, $top + 42 * $scale, 8 * $scale, 8 * $scale)
    $dark.Dispose()
    $light.Dispose()
    $accent.Dispose()
}

$icon = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$drawing = [System.Drawing.Graphics]::FromImage($icon)
$drawing.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
Draw-Mark $drawing 0 0 16
$icon.Save((Join-Path $assetRoot 'AppIcon.appiconset\AppIcon-512@2x.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$drawing.Dispose()
$icon.Dispose()

$splash = [System.Drawing.Bitmap]::new(2732, 2732, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$drawing = [System.Drawing.Graphics]::FromImage($splash)
$drawing.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$drawing.Clear([System.Drawing.ColorTranslator]::FromHtml('#F6F2EA'))
Draw-Mark $drawing 1142 1142 7
foreach ($fileName in @('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png')) {
    $splash.Save((Join-Path $assetRoot "Splash.imageset\$fileName"), [System.Drawing.Imaging.ImageFormat]::Png)
}
$drawing.Dispose()
$splash.Dispose()
Write-Output 'Updated iPhone and iPad assets from the existing Marginalia mark.'
