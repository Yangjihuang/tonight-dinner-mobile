$ErrorActionPreference = 'Stop'

$apiUrl = 'https://family-dinner-vote-2026.damonyangjihuang.chatgpt.site/api/state?code=HOOME'
$response = Invoke-WebRequest -Uri $apiUrl -Method Get -UseBasicParsing
$state = $response.Content | ConvertFrom-Json
$recipes = @($state.recipeLibrary)

if ($recipes.Count -ne 20) {
  throw "Expected 20 published recipes, received $($recipes.Count)."
}
if ($recipes | Where-Object { [string]::IsNullOrWhiteSpace($_.id) -or [string]::IsNullOrWhiteSpace($_.name) }) {
  throw 'Refusing to write recipes.json because a recipe has an empty id or name.'
}

$mobileRecipes = @($recipes | ForEach-Object {
  [PSCustomObject][ordered]@{
    id = $_.id
    name = $_.name
    description = $_.description
    category = $_.category
    cuisine_region = $_.cuisine_region
    cuisine_detail = $_.cuisine_detail
    flavor_tags = @($_.flavor_tags)
    calories_per_100g = $_.calories_per_100g
    prep_minutes = $_.prep_minutes
    cook_minutes = $_.cook_minutes
    difficulty = $_.difficulty
    cost_band = $_.cost_band
    allergens = @($_.allergens)
    dietary_tags = @($_.dietary_tags)
    image = "images/$($_.id).webp"
  }
})

$json = $mobileRecipes | ConvertTo-Json -Depth 8
$target = Join-Path $PSScriptRoot 'recipes.json'
[IO.File]::WriteAllText($target, $json, [Text.UTF8Encoding]::new($false))

$roundTrip = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
if (@($roundTrip).Count -ne 20) {
  throw 'recipes.json failed round-trip validation.'
}

Write-Output 'recipes.json updated and validated: 20 dishes'
