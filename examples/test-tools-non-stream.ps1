param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Model   = "gpt-5.4-mini",
    # tools.json から使用するツール名
    [string[]]$ToolNames = @("Bash", "Read")
)

$raw = Get-Content -Path "$PSScriptRoot\..\tools.json" -Raw
$tools = @(("{$raw}" | ConvertFrom-Json).tools | Where-Object { $_.name -in $ToolNames })

Write-Host "=== ツール付きリクエスト (非ストリーム) ===" -ForegroundColor Cyan
Write-Host "使用ツール: $($tools.name -join ', ')" -ForegroundColor Yellow

$body = @{
    model       = $Model
    max_tokens  = 512
    tools       = $tools
    tool_choice = @{ type = "any" }
    messages    = @(
        @{
            role    = "user"
            content = 'Use the Bash tool to run the command: echo "Hello from proxa"'
        }
    )
} | ConvertTo-Json -Depth 20

$response = Invoke-RestMethod `
    -Uri "$BaseUrl/v1/messages" `
    -Method POST `
    -Headers @{
        "Content-Type"      = "application/json"
        "x-api-key"         = "dummy"
        "anthropic-version" = "2023-06-01"
    } `
    -Body $body

Write-Host "`n=== レスポンス ===" -ForegroundColor Green
Write-Host "stop_reason : $($response.stop_reason)"
Write-Host "input_tokens: $($response.usage.input_tokens)"
Write-Host "output_tokens: $($response.usage.output_tokens)"

$toolUseBlocks = @($response.content | Where-Object { $_.type -eq "tool_use" })
$textBlocks    = @($response.content | Where-Object { $_.type -eq "text" })

if ($toolUseBlocks) {
    Write-Host "`n--- tool_use ブロック ---" -ForegroundColor Magenta
    foreach ($b in $toolUseBlocks) {
        Write-Host "  name : $($b.name)"
        Write-Host "  id   : $($b.id)"
        Write-Host "  input: $($b.input | ConvertTo-Json -Compress)"
    }
}

if ($textBlocks) {
    Write-Host "`n--- text ブロック ---" -ForegroundColor White
    foreach ($b in $textBlocks) {
        Write-Host $b.text
    }
}
