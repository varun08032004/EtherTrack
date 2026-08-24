$content = Get-Content 'C:\Users\ASUS\Desktop\EtherTrack\ethertrack-backend\routes\portfolio.js' -Raw
$idx = $content.IndexOf("res.json({ bought });")
if ($idx -ge 0) {
    $section = $content.Substring($idx, 500)
    $lines = $section -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        Write-Host ('Line ' + $i + ': [' + $line + ']')
    }
}