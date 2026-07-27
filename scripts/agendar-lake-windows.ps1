param(
  [string]$Horario = "02:00",
  [string]$NomeTarefa = "Nexus Lake - Atualizacao Diaria",
  [switch]$Substituir
)

$ErrorActionPreference = "Stop"
$raizProjeto = Split-Path -Parent $PSScriptRoot
$packageJson = Join-Path $raizProjeto "package.json"

if (-not (Test-Path -LiteralPath $packageJson)) {
  throw "package.json nao encontrado em $raizProjeto"
}

try {
  $horarioValidado = [DateTime]::ParseExact(
    $Horario,
    "HH:mm",
    [System.Globalization.CultureInfo]::InvariantCulture
  )
} catch {
  throw "Horario invalido. Use HH:mm, por exemplo 02:00."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$existente = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
if ($existente -and -not $Substituir) {
  throw "A tarefa '$NomeTarefa' ja existe. Use -Substituir para atualiza-la."
}

$acao = New-ScheduledTaskAction `
  -Execute $npm `
  -Argument "run lake:atualizar" `
  -WorkingDirectory $raizProjeto

$gatilho = New-ScheduledTaskTrigger -Daily -At $horarioValidado
$configuracoes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)

$usuarioAtual = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
  -UserId $usuarioAtual `
  -LogonType Interactive `
  -RunLevel Limited

$parametros = @{
  TaskName = $NomeTarefa
  Action = $acao
  Trigger = $gatilho
  Settings = $configuracoes
  Principal = $principal
  Description = "Atualiza Bronze, Silver e Gold do Nexus usando somente dias completos."
}
if ($Substituir) {
  $parametros.Force = $true
}

Register-ScheduledTask @parametros | Out-Null
Write-Host "Tarefa '$NomeTarefa' configurada diariamente para $Horario."
Write-Host "O modo padrao processa somente dias completos."
