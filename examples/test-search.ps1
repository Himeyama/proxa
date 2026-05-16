param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Model   = "gpt-5.4-mini",
    [string]$Query   = "PowerShell REST API examples"
)

Write-Host "`n==== google_search ツール単体テスト ====" -ForegroundColor Cyan
Write-Host "クエリ : $Query"
Write-Host "モデル : $Model"
Write-Host "URL    : $BaseUrl`n"

# google_search はサーバー側で内部実行されるため tool_choice は不要。
# 自然言語でリクエストし、最終的なテキストレスポンスを確認する。
$body = @{
    model      = $Model
    max_tokens = 1024
    messages   = @(@{ role = "user"; content = "Search the web for: $Query" })
} | ConvertTo-Json -Depth 10

Write-Host "── リクエスト送信 ───────────────────────────────────────────" -ForegroundColor DarkGray

try {
    $resp = Invoke-RestMethod `
        -Uri "$BaseUrl/v1/messages" `
        -Method POST `
        -Headers @{
            "Content-Type"      = "application/json"
            "x-api-key"         = "dummy"
            "anthropic-version" = "2023-06-01"
        } `
        -Body $body `
        -ErrorAction Stop
} catch {
    Write-Host "[FAIL] リクエスト失敗: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ── 結果評価 ──────────────────────────────────────────────────────
$textBlocks = @($resp.content | Where-Object { $_.type -eq "text" })
$text = ($textBlocks | Select-Object -First 1).text

Write-Host "stop_reason : $($resp.stop_reason)"
Write-Host "input_tokens: $($resp.usage.input_tokens)  output_tokens: $($resp.usage.output_tokens)`n"

if ($text) {
    Write-Host "[PASS] テキストレスポンス受信:" -ForegroundColor Green
    Write-Host $text
} else {
    Write-Host "[FAIL] テキストなし (content=$($resp.content | ConvertTo-Json -Compress))" -ForegroundColor Red
    Write-Host "`nサーバーコンソールで以下を確認してください:"
    Write-Host "  [google:search] HTTP <status>     ... HTTP エラー"
    Write-Host "  [google:search] no links found ... DuckDuckGo の HTML 構造変化の可能性"
    Write-Host "  [google:search] challenge page ... Cloudflare の bot 検知"
    exit 1
}
