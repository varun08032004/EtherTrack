$content = Get-Content 'C:\Users\ASUS\Desktop\EtherTrack\ethertrack-backend\routes\portfolio.js' -Raw
$idx = $content.IndexOf("res.json({ bought });")
if ($idx -ge 0) {
    $content.Substring($idx, 500)
}