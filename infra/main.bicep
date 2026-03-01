targetScope = 'subscription'

@description('Name of the environment (used for resource naming)')
param environmentName string

@description('Primary location for all resources')
param location string

// Resource group
resource rg 'Microsoft.Resources/resourceGroups@2024-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

// Static Web App
module swa 'swa.bicep' = {
  scope: rg
  params: {
    name: 'swa-${environmentName}'
    location: location
    tags: {
      'azd-env-name': environmentName
      'azd-service-name': 'web'
    }
  }
}

// Outputs consumed by azd
output AZURE_LOCATION string = location
output WEB_URI string = 'https://${swa.outputs.defaultHostname}'
output SWA_HOSTNAME string = swa.outputs.defaultHostname
