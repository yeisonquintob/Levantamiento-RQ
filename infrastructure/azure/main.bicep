targetScope = 'resourceGroup'

@description('Prefijo corto y único para todos los recursos.')
@minLength(3)
@maxLength(12)
param prefix string

param location string = resourceGroup().location
param environmentName string = 'prod'
param sqlAdministratorLogin string
@secure()
param sqlAdministratorPassword string

@description('Imágenes y configuración no secreta de las aplicaciones.')
param workloads array

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id, prefix)
var resourcePrefix = '${prefix}-${environmentName}'
var databaseNames = [
  'RqIdentityDb'
  'RqProjectsDb'
  'RqSourcesDb'
  'RqDocumentsDb'
  'RqAiAnalysisDb'
  'RqErpKnowledgeDb'
  'RqWorkflowDb'
  'RqOperationsDb'
]

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${resourcePrefix}-logs'
  location: location
  properties: {
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourcePrefix}-appi'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: replace('${prefix}${environmentName}${suffix}', '-', '')
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${resourcePrefix}-cae'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take(replace('${prefix}-${environmentName}-${suffix}-kv', '-', ''), 24)
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: { family: 'A', name: 'standard' }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take(replace('${prefix}${environmentName}${suffix}st', '-', ''), 24)
  location: location
  sku: { name: 'Standard_GRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}

resource sourceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'rq-sources'
  properties: { publicAccess: 'None' }
}

resource exportContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'rq-exports'
  properties: { publicAccess: 'None' }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${resourcePrefix}-sql-${suffix}'
  location: location
  properties: {
    administratorLogin: sqlAdministratorLogin
    administratorLoginPassword: sqlAdministratorPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: 'Disabled'
  }
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource databases 'Microsoft.Sql/servers/databases@2023-08-01-preview' = [for databaseName in databaseNames: {
  parent: sqlServer
  name: databaseName
  location: location
  sku: { name: 'S0', tier: 'Standard' }
  properties: {
    zoneRedundant: false
    readScale: 'Disabled'
  }
}]

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${resourcePrefix}-redis-${suffix}'
  location: location
  properties: {
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisVersion: '6'
    sku: { name: 'Standard', family: 'C', capacity: 1 }
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: '${resourcePrefix}-sb-${suffix}'
  location: location
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource integrationTopic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' = {
  parent: serviceBus
  name: 'rq-integration-v1'
  properties: {
    defaultMessageTimeToLive: 'P14D'
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    requiresDuplicateDetection: true
    supportOrdering: true
  }
}

resource jobQueues 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = [for queueName in [
  'source-processing'
  'ai-analysis'
  'document-exports'
]: {
  parent: serviceBus
  name: queueName
  properties: {
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P7D'
    lockDuration: 'PT1M'
    maxDeliveryCount: 5
  }
}]

resource applications 'Microsoft.App/containerApps@2024-03-01' = [for workload in workloads: {
  name: workload.name
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: workload.external
        targetPort: workload.port
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        { server: registry.properties.loginServer, identity: 'system' }
      ]
      secrets: [for secret in workload.keyVaultSecrets: {
        name: secret.name
        keyVaultUrl: secret.keyVaultUrl
        identity: 'system'
      }]
    }
    template: {
      containers: [
        {
          name: workload.name
          image: workload.image
          env: concat([
            { name: 'NODE_ENV', value: 'production' }
            { name: 'SERVICE_NAME', value: workload.name }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'PORT', value: string(workload.port) }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
          ], workload.env)
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: workload.healthPath, port: workload.port, scheme: 'HTTP' }
              initialDelaySeconds: 20
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: workload.healthPath, port: workload.port, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: workload.minReplicas, maxReplicas: workload.maxReplicas }
    }
  }
}]

var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
resource acrPullAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (workload, index) in workloads: {
  name: guid(registry.id, applications[index].id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: applications[index].identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}]

var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
resource vaultAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (workload, index) in workloads: {
  name: guid(vault.id, applications[index].id, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: applications[index].identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}]

output containerRegistry string = registry.properties.loginServer
output containerEnvironmentName string = containerEnvironment.name
output keyVaultName string = vault.name
output sqlServerName string = sqlServer.name
output storageAccountName string = storage.name
output serviceBusNamespace string = serviceBus.name
output applicationInsightsName string = insights.name
