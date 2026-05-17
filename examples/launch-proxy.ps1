# ant2chat 起動スクリプト
# -Provider openai (デフォルト) / ollama / responses / gemini で切り替え
param(
    [ValidateSet("openai", "ollama", "responses", "gemini")]
    [string]$Provider = "openai"
)

pnpm build

switch ($Provider) {
    "openai" {
        $url    = "https://api.openai.com/v1"
        $apiKey = $env:OPENAI_API_KEY
        $auth   = "bearer"
        $model  = "gpt-5.4-mini"
    }
    "ollama" {
        $url    = "http://localhost:11434/v1"
        $apiKey = "sk-dummy"
        $auth   = "bearer"
        $model  = "gemma4:e4b"
    }
    "responses" {
        $url    = "https://api.openai.com/v1"
        $apiKey = $env:OPENAI_API_KEY
        $auth   = "bearer"
        $model  = "gpt-5.4-mini"
    }
    "gemini" {
        $url    = $null
        $apiKey = $env:GOOGLE_GENERATIVE_AI_API_KEY
        $auth   = "bearer"
        $model  = "gemma-4-31b-it"
    }
}

$urlDisplay = if ($url) { $url } else { "(provider default)" }
Write-Host "Provider: $Provider  →  $urlDisplay"

$cmdArgs = @("--env-file=.env", "dist/index.js", "--port", "3000", "--api-key", $apiKey, "--auth-type", $auth, "--provider", $Provider, "--model", $model)
if ($url) { $cmdArgs += @("--url", $url) }
node @cmdArgs
