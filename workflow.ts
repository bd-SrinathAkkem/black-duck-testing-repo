import type { JSONSchema7 } from 'json-schema'

/**
 * workflowSchema
 *
 * Comprehensive JSON Schema for validating GitHub Actions workflow YAML objects
 * with specific validation for Black Duck security scan steps.
 *
 * Features:
 * - Validates basic workflow structure (name, on, jobs)
 * - Supports push, pull_request, workflow_dispatch, and other triggers
 * - Flexible job and step validation with user-defined names
 * - Specific validation for Black Duck security scan action
 * - Handles Polaris, Black Duck SCA, Coverity, and Fix PR scenarios
 * - Allows additional properties for extensibility
 *
 * @type {JSONSchema7}
 */
export const workflowSchema: JSONSchema7 = {
  type: 'object',
  required: ['name', 'on', 'jobs'],
  additionalProperties: true,
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      description: 'Name of the workflow',
    },
    on: {
      oneOf: [
        {
          type: 'string',
          enum: ['push', 'pull_request', 'workflow_dispatch', 'schedule'],
        },
        {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
          },
        },
        {
          type: 'object',
          additionalProperties: true,
          minProperties: 1,
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
                        { type: 'string', minLength: 1 },
                        {
                          type: 'array',
                          minItems: 1,
                          items: { type: 'string', minLength: 1 },
                        },
                      ],
                    },
                    'branches-ignore': {
                      oneOf: [
                        { type: 'string', minLength: 1 },
                        {
                          type: 'array',
                          minItems: 1,
                          items: { type: 'string', minLength: 1 },
                        },
                      ],
                    },
                    'paths': {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    'paths-ignore': {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    'tags': {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                    },
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
                    'branches': {
                      oneOf: [
                        { type: 'string', minLength: 1 },
                        {
                          type: 'array',
                          minItems: 1,
                          items: { type: 'string', minLength: 1 },
                        },
                      ],
                    },
                    'branches-ignore': {
                      oneOf: [
                        { type: 'string', minLength: 1 },
                        {
                          type: 'array',
                          minItems: 1,
                          items: { type: 'string', minLength: 1 },
                        },
                      ],
                    },
                    'paths': {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    'paths-ignore': {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    'types': {
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
                          type: {
                            type: 'string',
                            enum: ['boolean', 'choice', 'environment', 'string'],
                          },
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
                properties: {
                  cron: { type: 'string' },
                },
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
    defaults: {
      type: 'object',
      additionalProperties: true,
    },
    concurrency: {
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: {
            'group': { type: 'string' },
            'cancel-in-progress': { type: 'boolean' },
          },
        },
      ],
    },
    jobs: {
      type: 'object',
      minProperties: 1,
      patternProperties: {
        // Allow any job name (user-defined)
        '^[a-zA-Z_][a-zA-Z0-9_-]*$': {
          type: 'object',
          required: ['runs-on'],
          additionalProperties: true,
          properties: {
            'name': {
              type: 'string',
              description: 'Display name for the job',
            },
            'runs-on': {
              oneOf: [
                {
                  type: 'string',
                  minLength: 1,
                  description: 'Runner type (e.g., ubuntu-latest, windows-latest)',
                },
                {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
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
            'concurrency': {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    'group': { type: 'string' },
                    'cancel-in-progress': { type: 'boolean' },
                  },
                },
              ],
            },
            'outputs': {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            'env': {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Job-level environment variables',
            },
            'defaults': {
              type: 'object',
              additionalProperties: true,
            },
            'timeout-minutes': { type: 'number' },
            'strategy': {
              type: 'object',
              properties: {
                'matrix': {
                  type: 'object',
                  additionalProperties: true,
                },
                'fail-fast': { type: 'boolean' },
                'max-parallel': { type: 'number' },
              },
            },
            'continue-on-error': { type: 'boolean' },
            'container': {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    image: { type: 'string' },
                    credentials: {
                      type: 'object',
                      properties: {
                        username: { type: 'string' },
                        password: { type: 'string' },
                      },
                    },
                    env: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                    },
                    ports: {
                      type: 'array',
                      items: { type: 'number' },
                    },
                    volumes: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    options: { type: 'string' },
                  },
                },
              ],
            },
            'services': {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  image: { type: 'string' },
                  credentials: {
                    type: 'object',
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' },
                    },
                  },
                  env: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  ports: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  volumes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  options: { type: 'string' },
                },
              },
            },
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

                      // GitHub token for Fix PR functionality
                      github_token: { type: 'string' },

                      // Common configuration
                      network_airgap: { type: 'string' },
                      mark_build_status: { type: 'string' },
                    },
                  },
                  'env': {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      // All the same properties as 'with' above
                      polaris_server_url: { type: 'string' },
                      polaris_access_token: { type: 'string' },
                      blackducksca_url: { type: 'string' },
                      blackducksca_token: { type: 'string' },
                      coverity_url: { type: 'string' },
                      coverity_user: { type: 'string' },
                      coverity_passphrase: { type: 'string' },
                      github_token: { type: 'string' },
                    },
                  },
                },
                // Each step must have either 'uses' or 'run', but not both
                oneOf: [
                  {
                    required: ['uses'],
                    not: { required: ['run'] },
                  },
                  {
                    required: ['run'],
                    not: { required: ['uses'] },
                  },
                ],
              },
              // Add validation that requires at least one Black Duck step
              allOf: [
                {
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
              ],
            },
          },
        },
      },
    },
  },
}

// Type definitions for better TypeScript support
export interface BlackDuckStep {
  'id'?: string
  'name'?: string
  'if'?: string
  'uses': string // Should match pattern '^blackduck-inc/black-duck-security-scan@v'
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
  'env'?: {
    [key: string]: string
  }
}

export interface GitHubWorkflow {
  name: string
  on: any
  env?: { [key: string]: string }
  defaults?: any
  concurrency?: string | { 'group': string, 'cancel-in-progress'?: boolean }
  jobs: {
    [jobName: string]: {
      'name'?: string
      'runs-on': string | string[]
      'needs'?: string | string[]
      'if'?: string
      'environment'?: string | { name: string, url?: string }
      'concurrency'?: string | { 'group': string, 'cancel-in-progress'?: boolean }
      'outputs'?: { [key: string]: string }
      'env'?: { [key: string]: string }
      'defaults'?: any
      'timeout-minutes'?: number
      'strategy'?: {
        'matrix'?: any
        'fail-fast'?: boolean
        'max-parallel'?: number
      }
      'continue-on-error'?: boolean
      'container'?: string | any
      'services'?: { [key: string]: any }
      'steps': Array<BlackDuckStep | any>
      [key: string]: any
    }
  }
  [key: string]: any
}
