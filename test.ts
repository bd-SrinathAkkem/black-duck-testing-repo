import type { Platform, WorkflowConfig } from '../../types/config-types'
import { logger } from "../../utils/logger";

/**
 * WorkflowStep interface for a single step in a GitHub Actions workflow.
 * @property name - Step name
 * @property id - Optional step ID
 * @property uses - Optional action to use
 * @property with - Optional parameters for the action
 * @property run - Optional shell command to run
 * @property if - Optional condition for running the step
 * @property shell - Optional shell to use
 * @property continue-on-error - Optional flag to continue on error
 * @property env - Optional environment variables for the step
 */
interface WorkflowStep {
  'name': string
  'id'?: string
  'uses'?: string
  'with'?: Record<string, unknown>
  'run'?: Record<string, unknown>
  'if'?: string
  'shell'?: string
  'continue-on-error'?: boolean
  'env'?: Record<string, string>
}

/**
 * PlatformConfig interface for workflow configuration per platform.
 * @property name - Platform display name
 * @property steps - Array of workflow steps
 * @property env - Optional environment variables for the job
 * @property secrets - Optional list of required secrets
 */
interface PlatformConfig {
  name: string
  steps: WorkflowStep[]
  env?: Record<string, string>
  secrets?: string[]
}

const LATEST_VERSIONS = {
  checkout: '@v4',
  blackDuckScan: '@v2',
} as const

/* eslint-disable no-template-curly-in-string */
/**
 * DEFAULT_ENV
 *
 * Default environment variable expressions for workflow steps.
 */
const DEFAULT_ENV = {
  BLACKDUCKSCA_URL: '${{ vars.BLACKDUCKSCA_URL }}',
  COVERITY_URL: '${{ vars.COVERITY_URL }}',
  GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
  POLARIS_URL: '${{ vars.POLARIS_URL }}',
} as const

/**
 * DEFAULT_SECRETS
 *
 * Default secret expressions for workflow steps.
 */
const DEFAULT_SECRETS = {
  BLACKDUCKSCA_TOKEN: '${{ secrets.BLACKDUCKSCA_TOKEN }}',
  COVERITY_PASSPHRASE: '${{ secrets.COVERITY_PASSPHRASE }}',
  COVERITY_USER: '${{ secrets.COVERITY_USER }}',
  GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
  POLARIS_ACCESS_TOKEN: '${{ secrets.POLARIS_ACCESS_TOKEN }}',
} as const

const DEFAULT_GITHUB_CONFIG = {
  APPLICATION_NAME: '${{ github.event.repository.name }}',
  PROJECT_NAME: '${{ github.event.repository.name }}',
  BRANCH_NAME: '${{ github.event.ref_name }}',
} as const
/* eslint-enable no-template-curly-in-string */

/**
 * platformConfigs
 *
 * Maps each platform to its workflow configuration (steps, secrets, etc).
 */
const platformConfigs: Record<Platform, PlatformConfig> = {
  coverity: {
    name: 'Coverity Scan',
    steps: [
      {
        name: 'Checkout Source',
        uses: `actions/checkout${LATEST_VERSIONS.checkout}`,
      },
      {
        name: 'Coverity Scan',
        id: 'coverity-scan',
        uses: `blackduck-inc/black-duck-security-scan${LATEST_VERSIONS.blackDuckScan}`,
        with: {
          coverity_url: DEFAULT_ENV.COVERITY_URL,
          coverity_user: DEFAULT_SECRETS.COVERITY_USER,
          coverity_passphrase: DEFAULT_SECRETS.COVERITY_PASSPHRASE,
        },
      },
    ],
    secrets: ['COVERITY_PASSPHRASE', 'GITHUB_TOKEN'],
  },
  blackducksca: {
    name: 'Black Duck Security Scan',
    steps: [
      {
        name: 'Checkout Source',
        uses: `actions/checkout${LATEST_VERSIONS.checkout}`,
      },
      {
        name: 'Black Duck Security Scan',
        id: 'black-duck-security-scan',
        uses: `blackduck-inc/black-duck-security-scan${LATEST_VERSIONS.blackDuckScan}`,
        with: {
          blackducksca_url: DEFAULT_ENV.BLACKDUCKSCA_URL,
          blackducksca_token: DEFAULT_SECRETS.BLACKDUCKSCA_TOKEN,
        },
      },
    ],
    secrets: ['BLACKDUCKSCA_TOKEN', 'GITHUB_TOKEN'],
  },
  polaris: {
    name: 'Polaris Security Scan',
    steps: [
      {
        name: 'Checkout Source',
        uses: `actions/checkout${LATEST_VERSIONS.checkout}`,
      },
      {
        name: 'Polaris Security Scan',
        id: 'polaris-scan',
        uses: `blackduck-inc/black-duck-security-scan${LATEST_VERSIONS.blackDuckScan}`,
        with: {
          polaris_server_url: DEFAULT_ENV.POLARIS_URL,
          polaris_access_token: DEFAULT_SECRETS.POLARIS_ACCESS_TOKEN,
        },
      },
    ],
    secrets: ['POLARIS_ACCESS_TOKEN', 'GITHUB_TOKEN'],
  },
}

/**
 * Checks if a value is valid (not undefined, null, empty string, or empty object).
 * @param value - The value to check
 * @returns True if valid, false otherwise
 */
function isValidValue(value: unknown): boolean {
  if (value === undefined || value === null)
    return false
  if (typeof value === 'string' && value.trim() === '')
    return false
  return !(typeof value === 'object' && Object.keys(value as object).length === 0)
}

/**
 * Generates the workflow trigger configuration (on: ...).
 * @param config - The workflow config
 * @returns Trigger configuration object
 */
function generateTriggerConfig(config: WorkflowConfig): Record<string, unknown> {
  const triggers: Record<string, unknown> = {}

  if (config.branches?.push) {
    triggers.push = {
      branches: config.branches.push.split(',').map(b => b.trim()),
    }
  }

  if (config.branches?.pullRequest) {
    triggers.pull_request = {
      branches: config.branches.pullRequest.split(',').map(b => b.trim()),
    }
  }

  triggers.workflow_dispatch = {}

  return triggers
}

/**
 * Updates a workflow step with values from the workflow config.
 * Handles platform-specific and common scan/post-scan options.
 * @param step - The workflow step to update
 * @param config - The workflow config
 * @returns Updated workflow step
 */
function updateStepConfig(step: WorkflowStep, config: WorkflowConfig): WorkflowStep {
  const updatedStep = { ...step }
  const platform = config.platform

  if (!updatedStep.with || !platform) {
    return updatedStep
  }

  // Deep clone the 'with' object to avoid mutations
  updatedStep.with = { ...updatedStep.with }

  // Platform-specific configurations
  if (platform === 'coverity') {
    updatedStep.with.coverity_url = DEFAULT_ENV.COVERITY_URL
    updatedStep.with.coverity_user = DEFAULT_SECRETS.COVERITY_USER
    updatedStep.with.coverity_passphrase = DEFAULT_SECRETS.COVERITY_PASSPHRASE
    if (config.scanOptions?.analysisType) {
      updatedStep.with.coverity_local = config.scanOptions.analysisType === 'coverity-local'
    }
  }
  else if (platform === 'blackducksca') {
    updatedStep.with.blackducksca_url = DEFAULT_ENV.BLACKDUCKSCA_URL
    updatedStep.with.blackducksca_token = DEFAULT_SECRETS.BLACKDUCKSCA_TOKEN
  }
  else if (platform === 'polaris') {
    updatedStep.with.polaris_server_url = DEFAULT_ENV.POLARIS_URL
    updatedStep.with.polaris_access_token = DEFAULT_SECRETS.POLARIS_ACCESS_TOKEN
    if (config.scanOptions?.assessmentTypes) {
      updatedStep.with.polaris_assessment_types = config.scanOptions.assessmentTypes.join(',')
    }
  }

  // Common scan options
  if (config.scanOptions) {
    if (config.scanOptions.waitForScan !== undefined) {
      updatedStep.with[`${platform}_waitForScan`] = config.scanOptions.waitForScan
    }

    if (config.scanOptions.markBuildOnPolicyViolations !== undefined) {
      updatedStep.with.mark_build_status = config.scanOptions.markBuildOnPolicyViolations ? 'success' : 'failure'
    }

    if (config.scanOptions.captureDiagnostics !== undefined) {
      updatedStep.with.include_diagnostics = config.scanOptions.captureDiagnostics
    }
  }

  // Post-scan options
  if (config.postScanOptions) {
    if (config.postScanOptions.decoratePullRequests !== undefined) {
      updatedStep.with[`${platform}_prComment_enabled`] = config.postScanOptions.decoratePullRequests
      if (config.postScanOptions.decoratePullRequests) {
        updatedStep.with.github_token = DEFAULT_SECRETS.GITHUB_TOKEN
      }
    }

    if (platform === 'blackducksca' && config.postScanOptions.fixPullRequests !== undefined) {
      updatedStep.with[`${platform}_fixpr_enabled`] = config.postScanOptions.fixPullRequests
    }

    if (platform !== 'coverity') {
      if (config.postScanOptions.createSarifFile !== undefined) {
        updatedStep.with[`${platform}_reports_sarif_create`] = config.postScanOptions.createSarifFile
      }

      if (config.postScanOptions.uploadToGithub !== undefined) {
        updatedStep.with[`${platform}_upload_sarif_report`] = config.postScanOptions.uploadToGithub
      }
    }
  }

  return updatedStep
}

function getPolarisScanCommands(runsOn: string): string[] {
  if (/windows/i.test(runsOn)) {
    return [
      'Invoke-WebRequest -Uri ${{ vars.BRIDGECLI_WIN64 }} -OutFile bridge.zip',
      'Expand-Archive -Path bridge.zip -DestinationPath ${{ runner.temp }} -Force',
      'Remove-Item -Path bridge.zip -Force',
      '${{ runner.temp }}/bridge-cli --verbose --stage polaris'
    ]
  } else {
    return [
      'curl -fLsS -o bridge.zip ${{ vars.BRIDGECLI_LINUX64 }} && unzip -qo -d $RUNNER_TEMP bridge.zip && rm -f bridge.zip',
      '$RUNNER_TEMP/bridge-cli --stage polaris'
    ]
  }
}

function buildPolarisPRScanCommand(config: WorkflowConfig, runsOn: string): string {
  const lines = getPolarisScanCommands(runsOn)

  const postScanOptions: string[] = []

  if (config.postScanOptions?.decoratePullRequests) {
    postScanOptions.push('polaris.prcomment.enabled=true')
    postScanOptions.push(`github.user.token=${DEFAULT_SECRETS.GITHUB_TOKEN}`)
  }
  // postScanOptions.push('polaris.branch.parent.name=${{ github.event.base_ref }}')
  // postScanOptions.push('github.repository.branch.name=${{ github.ref_name }}')
  // postScanOptions.push('github.repository.name=${{ github.event.repository.name }}')
  // postScanOptions.push('github.repository.owner.name=${{ github.repository_owner }}')
  // postScanOptions.push('github.repository.pull.number=${{ github.event.number }}')

  if (postScanOptions.length > 0) {
    lines[1] += ` \\\n    ${postScanOptions.join(' \\\n    ')}`
  }

  return lines.join('\n')
}

/**
 * Updates a workflow step with values from the workflow config.
 * Handles platform-specific and common scan/post-scan options.
 * @param step - The workflow step to update
 * @param config - The workflow config
 * @returns Updated workflow step
 */
function updateStepConfigCLI(step: WorkflowStep, config: WorkflowConfig): WorkflowStep {
  const updatedStepCLI = { ...step }
  updatedStepCLI.run = {
    name: 'Setup Java JDK',
    uses: 'actions/setup-java@v3',
    with: {
      'java-version': '17',
      'distribution': 'microsoft',
      'cache': 'maven',
    },
  }
  const platform = config.platform

  if (!updatedStepCLI.run || !platform) {
    return updatedStepCLI
  }

  // Deep clone the 'run' object to avoid mutations
  updatedStepCLI.run = { ...updatedStepCLI.run }

  // // Platform-specific configurations
  // if (platform === 'coverity') {
  //   updatedStepCLI.run.coverity_url = DEFAULT_ENV.COVERITY_URL
  //   updatedStepCLI.run.coverity_user = DEFAULT_SECRETS.COVERITY_USER
  //   updatedStepCLI.run.coverity_passphrase = DEFAULT_SECRETS.COVERITY_PASSPHRASE
  //   if (config.scanOptions?.analysisType) {
  //     updatedStepCLI.run.coverity_local = config.scanOptions.analysisType === 'coverity-local'
  //   }
  // }
  // else if (platform === 'blackducksca') {
  //   updatedStepCLI.run.blackducksca_url = DEFAULT_ENV.BLACKDUCKSCA_URL
  //   updatedStepCLI.run.blackducksca_token = DEFAULT_SECRETS.BLACKDUCKSCA_TOKEN
  // }
  // else if (platform === 'polaris') {
  //   updatedStepCLI.run = {
  //     name: 'Polaris PR Scan',
  //     if: '${{ github.event_name == \'pull_request\' }}',
  //     run: buildPolarisPRScanCommand(config),
  //   }
  // }

  return updatedStepCLI
}

/**
 * Generates the full workflow YAML object for the given config for Actions.
 * Stores the config and workflow content in sessionStorage.
 * @param config - The workflow config
 * @returns Workflow YAML object
 */
export function generateWorkflowYaml(config: WorkflowConfig): Record<string, unknown> {
  // Default workflow content even when no platform is selected
  const defaultWorkflowContent: Record<string, unknown> = {
    name: 'Workflow',
    on: generateTriggerConfig(config),
    jobs: {
      scan: {
        'runs-on': 'ubuntu-latest',
        'steps': [
          {
            name: 'Checkout Source',
            uses: `actions/checkout${LATEST_VERSIONS.checkout}`,
          },
        ],
      },
    },
  }

  // If no platform is selected, return default workflow
  if (!config.platform) {
    return defaultWorkflowContent
  }

  const platformConfig = platformConfigs[config.platform]

  const workflowContent: Record<string, unknown> = {
    name: platformConfig.name,
    on: generateTriggerConfig(config),
    jobs: {
      [config.platform]: {
        'runs-on': 'ubuntu-latest',
        'steps': platformConfig.steps.map(step => updateStepConfig(step, config)),
      },
    },
  }

  // Add job-level env if present
  if (platformConfig.env) {
    const jobs = workflowContent.jobs as { scan: Record<string, unknown> }
    jobs.scan = {
      ...jobs.scan,
      env: platformConfig.env,
    }
  }

  return workflowContent
}

/**
 * Generates the full workflow YAML object for the given config for Bridge CLI.
 * Stores the config and workflow content in sessionStorage.
 * @param config - The workflow config
 * @returns Workflow YAML object
 */
export function generateWorkflowYamlBridgeCLI(config: WorkflowConfig): Record<string, unknown> {
  logger.info('Workflow', 'Generating Bridge CLI workflow YAML for config:', config)
  // Default workflow content even when no platform is selected
  const defaultWorkflowCLIContent: Record<string, unknown> = {
    name: 'Workflow',
    on: generateTriggerConfig(config),
    jobs: {
      scan: {
        'runs-on': 'ubuntu-latest',
        'steps': [
          {
            name: 'Checkout Source',
            uses: `actions/checkout${LATEST_VERSIONS.checkout}`,
          },
        ],
      },
    },
  }

  // If no platform is selected, return default workflow
  if (!config.platform) {
    return defaultWorkflowCLIContent
  }

  const platformCLIConfig = platformConfigs[config.platform]

  const workflowContent: Record<string, unknown> = {
    name: platformCLIConfig.name,
    on: generateTriggerConfig(config),
    jobs: {
      [config.platform]: {
        'runs-on': 'ubuntu-latest',
        'steps': platformCLIConfig.steps.map(step => updateStepConfigCLI(step, config)),
      },
    },
  }

  if (config.platform === 'polaris') {
    // Add Polaris-specific steps for Bridge CLI
    workflowContent.jobs[config.platform].steps.push({
      name: 'Polaris PR Scan',
      if: '${{ github.event_name == \'pull_request\' }}',
      run: buildPolarisPRScanCommand(config, workflowContent.jobs[config.platform]['runs-on'] as string),
    })
    workflowContent.env = {
      BRIDGE_POLARIS_SERVERURL: DEFAULT_ENV.POLARIS_URL,
      BRIDGE_POLARIS_ACCESSTOKEN: DEFAULT_SECRETS.POLARIS_ACCESS_TOKEN,
      BRIDGE_POLARIS_ASSESSMENT_TYPES: config.scanOptions?.assessmentTypes?.join(',') || '',
      BRIDGE_POLARIS_APPLICATION_NAME: DEFAULT_GITHUB_CONFIG.APPLICATION_NAME,
      BRIDGE_POLARIS_PROJECT_NAME: DEFAULT_GITHUB_CONFIG.PROJECT_NAME,
      BRIDGE_POLARIS_BRANCH_NAME: DEFAULT_GITHUB_CONFIG.BRANCH_NAME,
    }
  }

  // Add job-level env if present
  if (platformCLIConfig.env) {
    const jobs = workflowContent.jobs as { [config.platform]: Record<string, unknown> }
    jobs[config.platform] = {
      ...jobs[config.platform],
      env: platformCLIConfig.env,
    }
  }
  logger.info('Workflow', 'Generating Bridge CLI workflow YAML for config:', workflowContent)
  localStorage.setItem('workflowConfig', JSON.stringify(config))
  localStorage.setItem('workflowContent', JSON.stringify(workflowContent))
  return workflowContent
}

/**
 * Adds a custom step to a platform's workflow configuration.
 * @param platform - The platform to add the step to
 * @param step - The custom workflow step
 * @param position - 'before' to add at the start, 'after' to add at the end (default: 'after')
 * @returns True if added successfully, false otherwise
 */
export function addCustomStep(platform: Platform, step: WorkflowStep, position: 'before' | 'after' = 'after'): boolean {
  if (!platformConfigs[platform]) {
    throw new Error(`Platform ${platform} not found`)
  }

  if (!step.name || (!step.uses && !step.run)) {
    throw new Error('Custom step must have a name and either uses or run field')
  }

  try {
    if (position === 'before') {
      platformConfigs[platform].steps.unshift(step)
    }
    else {
      platformConfigs[platform].steps.push(step)
    }
    return true
  }
  catch (error) {
    console.error('', 'Error adding custom step:', error)
    return false
  }
}

/**
 * Adds a custom field to the workflow YAML object.
 * @param config - The workflow config
 * @param fieldName - The field name to add
 * @param fieldValue - The value to set for the field
 * @returns Updated workflow YAML object
 */
export function addCustomField(config: WorkflowConfig, fieldName: string, fieldValue: unknown): Record<string, unknown> {
  if (!isValidValue(fieldValue)) {
    throw new Error(`Invalid value provided for field: ${fieldName}`)
  }

  const isBridgeCLI = true
  const workflowContent = isBridgeCLI ? generateWorkflowYamlBridgeCLI(config) : generateWorkflowYaml(config)

  if (fieldName === 'on') {
    workflowContent.on = {
      ...(workflowContent.on as Record<string, unknown>),
      ...(fieldValue as Record<string, unknown>),
    }
  }
  else {
    workflowContent[fieldName] = fieldValue
  }

  return workflowContent
}

/**
 * Validates a custom field name and value for the workflow YAML.
 * @param fieldName - The field name
 * @param fieldValue - The value to validate
 * @returns True if valid, false otherwise
 */
export function validateCustomField(fieldName: string, fieldValue: unknown): boolean {
  if (!fieldName) {
    return false
  }
  return isValidValue(fieldValue)
}
