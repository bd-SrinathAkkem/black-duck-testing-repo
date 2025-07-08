import Ajv from 'ajv'
import * as yaml from 'js-yaml'
import { workflowSchema } from '../../config/workflows/workflow-schema'

export interface ValidationError {
  type: 'syntax-error' | 'missing-field' | 'invalid-value' | 'runner-label' | 'expression' | 'action' | 'glob' | 'configuration' | 'structure' | 'unexpected-key' | 'invalid-character' | 'unknown-input' | 'undefined-property' | 'type-mismatch'
  message: string
  line?: number
  column?: number
  path?: string
  severity: 'error' | 'warning'
}

interface YamlLocation {
  line: number
  column: number
  path: string
}

export function getYamlErrors(doc: string): ValidationError[] {
  const errors: ValidationError[] = []
  let parsedYaml: any = null
  let yamlMap: Map<string, YamlLocation> = new Map()

  // Step 1: Parse YAML and handle syntax errors
  try {
    parsedYaml = yaml.load(doc, { json: true })
    yamlMap = buildLocationMap(doc, parsedYaml)
  }
  catch (error: any) {
    if (error.mark) {
      errors.push({
        type: 'syntax-error',
        message: `YAML syntax error: ${error.reason}`,
        line: error.mark.line + 1,
        column: error.mark.column + 1,
        severity: 'error',
      })
    }
    else {
      errors.push({
        type: 'syntax-error',
        message: `YAML parsing failed: ${error.message}`,
        severity: 'error',
      })
    }
    return errors
  }

  // Step 2: Validate structure
  if (!parsedYaml || typeof parsedYaml !== 'object') {
    errors.push({
      type: 'structure',
      message: 'Workflow must be a valid YAML object',
      line: 1,
      severity: 'error',
    })
    return errors
  }

  // Step 3: Schema validation
  const ajv = new Ajv({ allErrors: true, verbose: true, strict: false })
  const validate = ajv.compile(workflowSchema)
  const isValid = validate(parsedYaml)

  if (!isValid && validate.errors) {
    for (const error of validate.errors) {
      const userError = convertAjvError(error, yamlMap, parsedYaml)
      if (userError) {
        errors.push(userError)
      }
    }
  }

  // Step 4: Additional specific validations
  const additionalErrors = performAdditionalValidations(parsedYaml, yamlMap)
  errors.push(...additionalErrors)

  // Step 5: Remove duplicates and sort by line number
  const uniqueErrors = removeDuplicateErrors(errors)
  return uniqueErrors.sort((a, b) => (a.line || 0) - (b.line || 0))
}

function buildLocationMap(yamlText: string, obj: any): Map<string, YamlLocation> {
  const map = new Map<string, YamlLocation>()
  const lines = yamlText.split('\n')

  function findKeyLocation(keyPath: string): YamlLocation {
    const pathParts = keyPath.split('.').filter(p => p && !p.match(/^\d+$/))
    const lastKey = pathParts[pathParts.length - 1]

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      if (trimmed === '' || trimmed.startsWith('#'))
        continue

      // Look for the key pattern
      if (trimmed.includes(`${lastKey}:`)) {
        const keyIndex = line.indexOf(`${lastKey}:`)
        if (keyIndex !== -1) {
          return {
            line: i + 1,
            column: keyIndex + 1,
            path: keyPath,
          }
        }
      }

      // Handle array items
      if (trimmed.startsWith('-') && keyPath.includes('steps')) {
        const stepMatch = keyPath.match(/steps\.(\d+)/)
        if (stepMatch) {
          const stepNumber = Number.parseInt(stepMatch[1])
          let stepCount = 0

          if (trimmed.startsWith('-')) {
            if (stepCount === stepNumber) {
              return {
                line: i + 1,
                column: line.indexOf('-') + 1,
                path: keyPath,
              }
            }
            stepCount++
          }
        }
      }
    }

    return { line: 1, column: 1, path: keyPath }
  }

  function traverse(obj: any, currentPath: string = '') {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          const arrayPath = `${currentPath}.${index}`
          map.set(arrayPath, findKeyLocation(arrayPath))
          traverse(item, arrayPath)
        })
      }
      else {
        for (const key in obj) {
          const fullPath = currentPath ? `${currentPath}.${key}` : key
          map.set(fullPath, findKeyLocation(fullPath))
          traverse(obj[key], fullPath)
        }
      }
    }
  }

  traverse(obj)
  return map
}

function convertAjvError(error: any, locationMap: Map<string, YamlLocation>, _workflow: any): ValidationError | null {
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.')
  const location = locationMap.get(path) || { line: 1, column: 1, path }

  // Root level errors
  if (error.instancePath === '') {
    if (error.keyword === 'required') {
      const missingField = error.params.missingProperty

      // Special handling for 'on' field
      if (missingField === 'on') {
        return {
          type: 'missing-field',
          message: `Missing required field 'on'. Add a trigger like 'on: push' etc.`,
          line: 1,
          column: 1,
          path: 'on',
          severity: 'error',
        }
      }

      return {
        type: 'missing-field',
        message: `Missing required field: '${missingField}'`,
        line: location.line,
        column: location.column,
        path: missingField,
        severity: 'error',
      }
    }

    if (error.keyword === 'anyOf' && error.schemaPath.includes('anyOf')) {
      return {
        type: 'configuration',
        message: 'Workflow must contain at least one job with a Black Duck security scan step',
        line: location.line,
        column: location.column,
        path: 'jobs',
        severity: 'error',
      }
    }
  }

  // Trigger configuration errors
  if (path === 'on' && error.keyword === 'oneOf') {
    return {
      type: 'invalid-value',
      message: `Invalid trigger configuration. The 'on' field accepts: 'on: [push, pull_request]'`,
      line: location.line,
      column: location.column,
      path: 'on',
      severity: 'error',
    }
  }

  // Job-specific errors
  if (path.includes('jobs.') && !path.includes('steps')) {
    const jobName = path.split('.')[1]

    if (error.keyword === 'required' && error.params.missingProperty === 'runs-on') {
      return {
        type: 'runner-label',
        message: `Job '${jobName}' requires 'runs-on' field. Example: runs-on: ubuntu-latest`,
        line: location.line,
        column: location.column,
        path: `${path}.runs-on`,
        severity: 'error',
      }
    }

    if (error.keyword === 'required' && error.params.missingProperty === 'steps') {
      return {
        type: 'structure',
        message: `Job '${jobName}' requires at least one step.`,
        line: location.line,
        column: location.column,
        path: `${path}.steps`,
        severity: 'error',
      }
    }

    if (error.keyword === 'minItems' && path.includes('steps')) {
      return {
        type: 'structure',
        message: `Job '${jobName}' must contain at least one step`,
        line: location.line,
        column: location.column,
        path: `${path}.steps`,
        severity: 'error',
      }
    }
  }

  // Step-specific errors
  if (path.includes('steps')) {
    const pathParts = path.split('.')
    const jobName = pathParts[1]
    const stepIndex = pathParts[3]

    if (error.keyword === 'oneOf' && error.schemaPath.includes('oneOf')) {
      return {
        type: 'structure',
        message: `Step ${Number.parseInt(stepIndex) + 1} in job '${jobName}' must have either 'uses' for actions or 'run' for shell commands. But not both together.`,
        line: location.line,
        column: location.column,
        path,
        severity: 'error',
      }
    }

    if (error.keyword === 'pattern' && error.propertyName === 'id') {
      return {
        type: 'invalid-value',
        message: `Step ID must start with letter/underscore, followed by letters/numbers/underscores/hyphens. Examples: 'build', 'test_1', 'deploy-prod'`,
        line: location.line,
        column: location.column,
        path,
        severity: 'error',
      }
    }

    if (error.keyword === 'pattern' && path.includes('uses')) {
      return {
        type: 'action',
        message: `Invalid action format. Use: 'owner/repo@version'. For example, blackduck-inc/black-duck-security-scan@v2`,
        line: location.line,
        column: location.column,
        path,
        severity: 'error',
      }
    }
  }

  // Black Duck specific errors
  if (path.includes('uses') && error.data?.includes('blackduck-inc')) {
    return {
      type: 'action',
      message: `Provide at least one of the product URL (polaris_server_url, coverity_url, blackducksca_url, or srm_url) and access tokens to proceed.`,
      line: location.line,
      column: location.column,
      path,
      severity: 'error',
    }
  }

  if (path.includes('with') && error.keyword === 'anyOf') {
    return {
      type: 'configuration',
      message: `Provide at least one of the product URL (polaris_server_url, coverity_url, blackducksca_url, or srm_url) and access tokens to proceed.`,
      line: location.line,
      column: location.column,
      path,
      severity: 'error',
    }
  }

  // Generic type errors
  if (error.keyword === 'type') {
    const expectedType = error.params.type
    const actualType = typeof error.data

    return {
      type: 'invalid-value',
      message: `Expected ${expectedType} but got ${actualType}`,
      line: location.line,
      column: location.column,
      path,
      severity: 'error',
    }
  }

  if (error.keyword === 'minLength') {
    return {
      type: 'invalid-value',
      message: `Value cannot be empty`,
      line: location.line,
      column: location.column,
      path,
      severity: 'error',
    }
  }

  if (error.keyword === 'enum') {
    return {
      type: 'invalid-value',
      message: `Invalid value '${error.data}'. Valid options: ${error.params.allowedValues.join(', ')}`,
      line: location.line,
      column: location.column,
      path,
      severity: 'error',
    }
  }

  return null
}

function performAdditionalValidations(workflow: any, locationMap: Map<string, YamlLocation>): ValidationError[] {
  const errors: ValidationError[] = []

  // Available GitHub-hosted runners
  const availableRunners = [
    'windows-latest',
    'ubuntu-latest',
    'ubuntu-24.04',
    'ubuntu-24.04-arm',
    'ubuntu-22.04',
    'ubuntu-22.04-arm',
    'ubuntu-20.04',
    'macos-latest',
    'macos-latest-xl',
    'self-hosted',
    'x64',
    'arm',
    'arm64',
    'linux',
    'macos',
    'windows',
  ]

  // Check for unknown runner labels
  if (workflow.jobs) {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const jobObj = job as any
      if (jobObj['runs-on']) {
        const runnerLabel = typeof jobObj['runs-on'] === 'string' ? jobObj['runs-on'] : jobObj['runs-on'][0]

        if (runnerLabel && typeof runnerLabel === 'string') {
          if (!availableRunners.includes(runnerLabel)) {
            const location = locationMap.get(`jobs.${jobName}.runs-on`) || { line: 1, column: 1, path: '' }
            errors.push({
              type: 'runner-label',
              message: `Unknown runner "${runnerLabel}". Valid GitHub-hosted runners include: ubuntu-latest, windows-latest, macos-latest, or use self-hosted: self-hosted.`,
              line: location.line,
              column: location.column,
              path: `jobs.${jobName}.runs-on`,
              severity: 'error',
            })
          }
        }
      }
    }
  }

  // Check for unexpected keys in trigger sections
  if (workflow.on && typeof workflow.on === 'object') {
    const validPushKeys = ['branches', 'branches-ignore', 'paths', 'paths-ignore', 'tags', 'tags-ignore']
    const validPullRequestKeys = ['branches', 'branches-ignore', 'paths', 'paths-ignore', 'types']

    if (workflow.on.push && typeof workflow.on.push === 'object') {
      for (const key of Object.keys(workflow.on.push)) {
        if (!validPushKeys.includes(key)) {
          const location = locationMap.get(`on.push.${key}`) || { line: 1, column: 1, path: '' }
          errors.push({
            type: 'unexpected-key',
            message: `Unknown key "${key}" in push trigger. Valid keys: ${validPushKeys.join(', ')}`,
            line: location.line,
            column: location.column,
            path: `on.push.${key}`,
            severity: 'error',
          })
        }
      }
    }

    if (workflow.on.pull_request && typeof workflow.on.pull_request === 'object') {
      for (const key of Object.keys(workflow.on.pull_request)) {
        if (!validPullRequestKeys.includes(key)) {
          const location = locationMap.get(`on.pull_request.${key}`) || { line: 1, column: 1, path: '' }
          errors.push({
            type: 'unexpected-key',
            message: `Unknown key "${key}" in pull_request trigger. Valid keys: ${validPullRequestKeys.join(', ')}`,
            line: location.line,
            column: location.column,
            path: `on.pull_request.${key}`,
            severity: 'error',
          })
        }
      }
    }
  }

  // Check for potentially untrusted expressions
  function _checkUntrustedExpressions(value: string, path: string): void {
    const untrustedPatterns = [
      'github.event.head_commit.message',
      'github.event.pull_request.title',
      'github.event.pull_request.body',
      'github.event.issue.title',
      'github.event.issue.body',
      'github.event.comment.body',
    ]

    for (const pattern of untrustedPatterns) {
      if (value.includes(pattern)) {
        const location = locationMap.get(path) || { line: 1, column: 1, path }
        errors.push({
          type: 'expression',
          message: `Potentially unsafe: "${pattern}" should be passed through environment variables to prevent code injection`,
          line: location.line,
          column: location.column,
          path,
          severity: 'warning',
        })
      }
    }
  }

  // Check for unknown action inputs
  const knownActionInputs = {
    // 'actions/setup-node@v4': ['always-auth', 'architecture', 'cache', 'cache-dependency-path', 'check-latest', 'node-version', 'node-version-file', 'registry-url', 'scope', 'token'],
    // 'actions/setup-node@v3': ['always-auth', 'architecture', 'cache', 'cache-dependency-path', 'check-latest', 'node-version', 'node-version-file', 'registry-url', 'scope', 'token'],
    // 'actions/setup-python@v4': ['python-version', 'python-version-file', 'cache', 'architecture', 'check-latest', 'token', 'cache-dependency-path'],
    // 'actions/setup-python@v3': ['python-version', 'python-version-file', 'cache', 'architecture', 'check-latest', 'token', 'cache-dependency-path'],
    // 'actions/checkout@v4': ['repository', 'ref', 'token', 'ssh-key', 'ssh-known-hosts', 'ssh-strict', 'persist-credentials', 'path', 'clean', 'fetch-depth', 'lfs', 'submodules', 'set-safe-directory'],
    // 'actions/checkout@v3': ['repository', 'ref', 'token', 'ssh-key', 'ssh-known-hosts', 'ssh-strict', 'persist-credentials', 'path', 'clean', 'fetch-depth', 'lfs', 'submodules', 'set-safe-directory'],
    // 'actions/upload-artifact@v4': ['name', 'path', 'if-no-files-found', 'retention-days', 'compression-level', 'overwrite'],
    // 'actions/upload-artifact@v3': ['name', 'path', 'if-no-files-found', 'retention-days'],
    // 'actions/download-artifact@v4': ['name', 'path', 'pattern', 'merge-multiple', 'github-token', 'repository', 'run-id'],
    // 'actions/download-artifact@v3': ['name', 'path', 'github-token', 'repository', 'run-id'],
  }

  // Validate action inputs and expressions
  if (workflow.jobs) {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const jobObj = job as any
      if (jobObj.steps && Array.isArray(jobObj.steps)) {
        jobObj.steps.forEach((step: any, stepIndex: number) => {
          // Check action inputs
          if (step.uses && step.with) {
            // Find matching action (handle different versions)
            const actionKey = Object.keys(knownActionInputs).find(key =>
              step.uses.startsWith(key.split('@')[0]),
            )

            if (actionKey) {
              const validInputs = knownActionInputs[actionKey]
              for (const inputKey of Object.keys(step.with)) {
                if (!validInputs.includes(inputKey)) {
                  const location = locationMap.get(`jobs.${jobName}.steps.${stepIndex}.with.${inputKey}`) || { line: 1, column: 1, path: '' }
                  errors.push({
                    type: 'unknown-input',
                    message: `Unknown input "${inputKey}" for action "${step.uses}". Valid inputs: ${validInputs.join(', ')}`,
                    line: location.line,
                    column: location.column,
                    path: `jobs.${jobName}.steps.${stepIndex}.with.${inputKey}`,
                    severity: 'error',
                  })
                }
              }
            }
          }

          // Check expressions in all string values
          function checkStrings(obj: any, basePath: string): void {
            if (typeof obj === 'string') {
              // checkUntrustedExpressions(obj, basePath)
            }
            else if (obj && typeof obj === 'object') {
              for (const [key, value] of Object.entries(obj)) {
                checkStrings(value, `${basePath}.${key}`)
              }
            }
          }

          checkStrings(step, `jobs.${jobName}.steps.${stepIndex}`)
        })
      }
    }
  }

  return errors
}

function removeDuplicateErrors(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>()
  return errors.filter((error) => {
    const key = `${error.type}-${error.message}-${error.line}-${error.column}-${error.path}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

// Helper function to format errors for display
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return 'No errors found!'
  }

  return errors.map((error) => {
    const location = error.line && error.column ? `line:${error.line}, col:${error.column}` : ''
    const path = error.path ? ` [${error.path}]` : ''
    return `${location} ${error.message} ${path}`
  }).join('\n\n')
}

// Usage example with better error messages:
const yamlContent = `
name: CI Pipeline
on:
  push:
    branch: main
jobs:
  build:
    runs-on: linux-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test
        run: echo 'test'
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          invalid_input: 'test'
`

const errors = getYamlErrors(yamlContent)
console.log(formatErrors(errors))
