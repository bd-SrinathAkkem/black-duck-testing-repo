import type { JSONSchema7 } from 'json-schema'

/**
 * Fixed GitHub Actions workflow schema with proper Black Duck security scan validation
 *
 * Key fixes:
 * - Proper Black Duck step validation with required fields
 * - Correct placement of 'contains' constraint
 * - Required configuration based on Black Duck tool type
 */
export const workflowSchema: JSONSchema7 = {
  type: 'object',
  required: ['name', 'on', 'jobs'],
  additionalProperties: true,
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      description: 'Workflow name',
    },

    on: {
      oneOf: [
        // Simple trigger: "push" or ["push", "pull_request"]
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },

        // Complex trigger with configurations
        {
          type: 'object',
          additionalProperties: true,
          properties: {
            push: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    'branches': {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                    },
                    'branches-ignore': {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                    },
                    'paths': { type: 'array', items: { type: 'string' } },
                    'paths-ignore': { type: 'array', items: { type: 'string' } },
                  },
                },
              ],
            },
            pull_request: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    branches: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                    },
                    types: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: ['opened', 'synchronize', 'reopened', 'closed'],
                      },
                    },
                  },
                },
              ],
            },
            workflow_dispatch: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    inputs: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          description: { type: 'string' },
                          required: { type: 'boolean' },
                          default: { type: 'string' },
                          type: { type: 'string', enum: ['boolean', 'choice', 'environment', 'string'] },
                        },
                      },
                    },
                  },
                },
              ],
            },
            schedule: {
              type: 'array',
              items: {
                type: 'object',
                required: ['cron'],
                properties: { cron: { type: 'string' } },
              },
            },
          },
        },
      ],
    },

    env: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Global environment variables',
    },

    jobs: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['runs-on'],
        additionalProperties: true,
        properties: {
          'name': { type: 'string' },
          'runs-on': {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          'needs': {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          'if': { type: 'string' },
          'environment': {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            ],
          },
          'env': {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          'timeout-minutes': { type: 'number' },
          'continue-on-error': { type: 'boolean' },

          'steps': {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                'id': { type: 'string' },
                'name': { type: 'string' },
                'if': { type: 'string' },
                'uses': { type: 'string' },
                'run': { type: 'string' },
                'shell': { type: 'string' },
                'working-directory': { type: 'string' },
                'continue-on-error': { type: 'boolean' },
                'timeout-minutes': { type: 'number' },

                'with': {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    // Polaris configuration
                    polaris_server_url: { type: 'string' },
                    polaris_access_token: { type: 'string' },

                    // Black Duck SCA configuration
                    blackducksca_url: { type: 'string' },
                    blackducksca_token: { type: 'string' },

                    // Coverity configuration
                    coverity_url: { type: 'string' },
                    coverity_user: { type: 'string' },
                    coverity_passphrase: { type: 'string' },

                    // GitHub token for Fix PR
                    github_token: { type: 'string' },

                    // Common configuration
                    network_airgap: { type: 'string' },
                    mark_build_status: { type: 'string' },
                  },
                },

                'env': {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },

              // Step must have either 'uses' or 'run'
              oneOf: [
                { required: ['uses'], not: { required: ['run'] } },
                { required: ['run'], not: { required: ['uses'] } },
              ],

              // If using Black Duck action, enforce required configuration
              if: {
                properties: {
                  uses: {
                    type: 'string',
                    pattern: '^blackduck-inc/black-duck-security-scan@v2$',
                  },
                },
                required: ['uses'],
              },
              then: {
                required: ['with'],
                properties: {
                  with: {
                    type: 'object',
                    anyOf: [
                      // Polaris configuration
                      {
                        required: ['polaris_server_url', 'polaris_access_token'],
                        properties: {
                          polaris_server_url: { type: 'string', minLength: 1 },
                          polaris_access_token: { type: 'string', minLength: 1 },
                        },
                      },
                      // Black Duck SCA configuration
                      {
                        required: ['blackducksca_url', 'blackducksca_token'],
                        properties: {
                          blackducksca_url: { type: 'string', minLength: 1 },
                          blackducksca_token: { type: 'string', minLength: 1 },
                        },
                      },
                      // Coverity configuration
                      {
                        required: ['coverity_url', 'coverity_user', 'coverity_passphrase'],
                        properties: {
                          coverity_url: { type: 'string', minLength: 1 },
                          coverity_user: { type: 'string', minLength: 1 },
                          coverity_passphrase: { type: 'string', minLength: 1 },
                        },
                      },
                      // Fix PR configuration (requires GitHub token)
                      {
                        required: ['github_token'],
                        properties: {
                          github_token: { type: 'string', minLength: 1 },
                        },
                      },
                    ],
                  },
                },
              },
            },

            // FIXED: Ensure at least one Black Duck step exists in the workflow
            contains: {
              type: 'object',
              required: ['uses'],
              properties: {
                uses: {
                  type: 'string',
                  pattern: '^blackduck-inc/black-duck-security-scan@v',
                },
              },
            },
          },
        },
      },

      // Additional validation: At least one job must have a Black Duck step
      patternProperties: {
        '.*': {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              contains: {
                type: 'object',
                required: ['uses'],
                properties: {
                  uses: {
                    type: 'string',
                    pattern: '^blackduck-inc/black-duck-security-scan@v',
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  // ADDITIONAL: Ensure at least one job has Black Duck step
  properties: {
    jobs: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            contains: {
              type: 'object',
              required: ['uses'],
              properties: {
                uses: {
                  type: 'string',
                  pattern: '^blackduck-inc/black-duck-security-scan@v',
                },
              },
            },
          },
        },
      },
    },
  },
}

// Alternative approach: More explicit validation function
export function validateWorkflowWithBlackDuck(workflow: any): { valid: boolean, errors: string[] } {
  const errors: string[] = []

  // Check if workflow has jobs
  if (!workflow.jobs || typeof workflow.jobs !== 'object') {
    errors.push('Workflow must have jobs')
    return { valid: false, errors }
  }

  // Check if at least one job has Black Duck step
  let hasBlackDuckStep = false

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!job || typeof job !== 'object')
      continue

    const steps = (job as any).steps
    if (!Array.isArray(steps))
      continue

    for (const step of steps) {
      if (step.uses && step.uses.startsWith('blackduck-inc/black-duck-security-scan@v')) {
        hasBlackDuckStep = true

        // Validate required configuration
        if (!step.with) {
          errors.push(`Black Duck step in job '${jobName}' missing required 'with' configuration`)
          continue
        }

        // Check if at least one valid configuration set is present
        const hasPolaris = step.with.polaris_server_url && step.with.polaris_access_token
        const hasSCA = step.with.blackducksca_url && step.with.blackducksca_token
        const hasCoverity = step.with.coverity_url && step.with.coverity_user && step.with.coverity_passphrase
        const hasFixPR = step.with.github_token

        if (!hasPolaris && !hasSCA && !hasCoverity && !hasFixPR) {
          errors.push(`Black Duck step in job '${jobName}' missing required configuration. Must have one of: Polaris (polaris_server_url + polaris_access_token), SCA (blackducksca_url + blackducksca_token), Coverity (coverity_url + coverity_user + coverity_passphrase), or Fix PR (github_token)`)
        }
      }
    }
  }

  if (!hasBlackDuckStep) {
    errors.push('Workflow must contain at least one Black Duck security scan step')
  }

  return { valid: errors.length === 0, errors }
}

// Export interfaces (unchanged)
export interface BlackDuckStep {
  'id'?: string
  'name'?: string
  'if'?: string
  'uses': string // Must match Black Duck action pattern
  'continue-on-error'?: boolean
  'timeout-minutes'?: number
  'with'?: {
    // Polaris
    polaris_server_url?: string
    polaris_access_token?: string

    // Black Duck SCA
    blackducksca_url?: string
    blackducksca_token?: string

    // Coverity
    coverity_url?: string
    coverity_user?: string
    coverity_passphrase?: string

    // GitHub token for Fix PR
    github_token?: string

    // Common
    network_airgap?: string
    mark_build_status?: string

    [key: string]: any
  }
  'env'?: Record<string, string>
}

export interface WorkflowJob {
  'name'?: string
  'runs-on': string | string[]
  'needs'?: string | string[]
  'if'?: string
  'environment'?: string | { name: string, url?: string }
  'env'?: Record<string, string>
  'timeout-minutes'?: number
  'continue-on-error'?: boolean
  'steps': Array<BlackDuckStep | any>
  [key: string]: any
}

export interface GitHubWorkflow {
  name: string
  on: any
  env?: Record<string, string>
  jobs: Record<string, WorkflowJob>
  [key: string]: any
}
