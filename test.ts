/**
 * @file Workflow Validation Utilities
 * @module utils/workflow-validation
 * @description Utilities for validating workflow files and filenames
 */

import type { Diagnostic } from '@codemirror/lint'
import Ajv from 'ajv'
import * as jsyaml from 'js-yaml'
import { workflowSchema } from '../../config/workflows/workflow-schema'
import { logger } from '../logger'
import { getSecurityWarnings } from './workflowSecurity'

export interface FilenameValidationError {
  type: 'extension' | 'characters' | 'length' | 'reserved' | 'path'
  message: string
}

export interface ValidationError {
  type: 'syntax-error' | 'missing-field' | 'invalid-value' | 'runner-label' | 'expression' | 'action' | 'glob' | 'configuration' | 'structure' | 'unexpected-key' | 'invalid-character' | 'unknown-input' | 'undefined-property' | 'type-mismatch'
  types?: string[]
  message: string
  line?: number
  column?: number
  path?: string
  paths?: string[]
  severity: 'error' | 'warning'
}

interface YamlLocation {
  line: number
  column: number
  path: string
}

// GitHub workflow filename validation constants
export const GITHUB_WORKFLOW_VALIDATION = {
  // Valid extensions for GitHub workflow files
  validExtensions: ['.yml', '.yaml'],

  // Maximum filename length (GitHub has a 255 character limit for file paths)
  maxLength: 100, // Conservative limit for just the filename

  // Reserved names that should be avoided
  reservedNames: [
    'con',
    'prn',
    'aux',
    'nul',
    'com1',
    'com2',
    'com3',
    'com4',
    'com5',
    'com6',
    'com7',
    'com8',
    'com9',
    'lpt1',
    'lpt2',
    'lpt3',
    'lpt4',
    'lpt5',
    'lpt6',
    'lpt7',
    'lpt8',
    'lpt9',
  ],

  // Invalid characters for GitHub file names
  // eslint-disable-next-line no-control-regex
  invalidCharacters: /[<>:"|?*\x00-\x1F\x7F]/,

  // Characters that should be avoided (though not strictly invalid)
  discouragedCharacters: /[#%&{}\\<>*?/$!'":@+`|=]/,

  // Valid character pattern (letters, numbers, hyphens, underscores, dots)
  validPattern: /^[\w.-]+$/,
}

/**
 * Get YAML validation errors
 */
export function getYamlErrors(doc: string): ValidationError[] {
  const errors: ValidationError[] = []
  let parsedYaml: any = null
  let yamlMap: Map<string, YamlLocation> = new Map()

  // Step 1: Parse YAML and handle syntax errors
  try {
    parsedYaml = jsyaml.load(doc, { json: true })
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

  // Only validate critical structural issues and security concerns
  // Removed runner label validation - users can use any runner
  // Removed action input validation - users can use any inputs
  // Removed trigger key validation - users can use any trigger configuration

  // Check for potentially untrusted expressions (keep as warnings for security)
  function checkUntrustedExpressions(value: string, path: string): void {
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

  // Check expressions in all string values (security warnings only)
  if (workflow.jobs) {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const jobObj = job as any
      if (jobObj.steps && Array.isArray(jobObj.steps)) {
        jobObj.steps.forEach((step: any, stepIndex: number) => {
          function checkStrings(obj: any, basePath: string): void {
            if (typeof obj === 'string') {
              checkUntrustedExpressions(obj, basePath)
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
  const errorMap = new Map<string, ValidationError>()

  for (const error of errors) {
    // Create a key based on message and location only
    const key = `${error.message}-${error.line || 0}-${error.column || 0}`

    if (errorMap.has(key)) {
      // Merge with existing error
      const existingError = errorMap.get(key)!

      // Collect all types
      const allTypes = [existingError.type]
      if (existingError.types) {
        allTypes.push(...(existingError.types as ValidationError['type'][]))
      }
      if (!allTypes.includes(error.type)) {
        allTypes.push(error.type)
      }

      // Collect all paths
      const allPaths = []
      if (existingError.path) {
        allPaths.push(existingError.path)
      }
      if (existingError.paths) {
        allPaths.push(...existingError.paths)
      }
      if (error.path && !allPaths.includes(error.path)) {
        allPaths.push(error.path)
      }

      // Update the existing error
      if (allTypes.length > 1) {
        existingError.types = allTypes.slice(1)
      }
      if (allPaths.length > 1) {
        existingError.paths = allPaths.slice(1)
      }

      // Keep the highest severity (error > warning)
      if (error.severity === 'error' && existingError.severity === 'warning') {
        existingError.severity = 'error'
      }
    }
    else {
      // Add new error
      errorMap.set(key, { ...error })
    }
  }

  return Array.from(errorMap.values())
}

/**
 * Validates GitHub workflow filename
 */
export function validateWorkflowFilename(filename: string): FilenameValidationError[] {
  const errors: FilenameValidationError[] = []

  if (!filename || filename.trim() === '') {
    errors.push({
      type: 'length',
      message: 'Filename cannot be empty',
    })
    return errors
  }

  const trimmedFilename = filename.trim()

  // Check length
  if (trimmedFilename.length > GITHUB_WORKFLOW_VALIDATION.maxLength) {
    errors.push({
      type: 'length',
      message: `Filename is too long (${trimmedFilename.length} characters). Maximum length is ${GITHUB_WORKFLOW_VALIDATION.maxLength} characters.`,
    })
  }

  if (trimmedFilename.length < 1) {
    errors.push({
      type: 'length',
      message: 'Filename must be at least 1 character long',
    })
  }

  // Check for path separators (should not contain directory paths)
  if (trimmedFilename.includes('/') || trimmedFilename.includes('\\')) {
    errors.push({
      type: 'path',
      message: 'Filename cannot contain path separators (/ or \\). Only the filename is allowed.',
    })
  }

  // Check extension
  const hasValidExtension = GITHUB_WORKFLOW_VALIDATION.validExtensions.some(ext =>
    trimmedFilename.toLowerCase().endsWith(ext),
  )

  if (!hasValidExtension) {
    errors.push({
      type: 'extension',
      message: `Filename must end with ${GITHUB_WORKFLOW_VALIDATION.validExtensions.join(' or ')} extension for GitHub workflows.`,
    })
  }

  // Check for invalid characters
  if (GITHUB_WORKFLOW_VALIDATION.invalidCharacters.test(trimmedFilename)) {
    errors.push({
      type: 'characters',
      message: 'Filename contains invalid characters. Avoid: < > : " | ? * and control characters.',
    })
  }

  // Check for discouraged characters (warning level)
  if (GITHUB_WORKFLOW_VALIDATION.discouragedCharacters.test(trimmedFilename)) {
    const discouragedChars = trimmedFilename.match(GITHUB_WORKFLOW_VALIDATION.discouragedCharacters)?.join('') || ''
    errors.push({
      type: 'characters',
      message: `Filename contains discouraged characters (${discouragedChars}). Consider using only letters, numbers, hyphens, underscores, and dots for better compatibility.`,
    })
  }

  // Check if filename uses only valid characters
  if (!GITHUB_WORKFLOW_VALIDATION.validPattern.test(trimmedFilename)) {
    errors.push({
      type: 'characters',
      message: 'Filename should only contain letters, numbers, hyphens (-), underscores (_), and dots (.).',
    })
  }

  // Check for reserved names (without extension)
  const nameWithoutExtension = trimmedFilename.replace(/\.(yml|yaml)$/i, '').toLowerCase()
  if (GITHUB_WORKFLOW_VALIDATION.reservedNames.includes(nameWithoutExtension)) {
    errors.push({
      type: 'reserved',
      message: `"${nameWithoutExtension}" is a reserved name. Please choose a different filename.`,
    })
  }

  // Check for common problematic patterns
  if (trimmedFilename.startsWith('.')) {
    errors.push({
      type: 'characters',
      message: 'Filename should not start with a dot (.) as it may be treated as a hidden file.',
    })
  }

  if (trimmedFilename.endsWith('.')) {
    errors.push({
      type: 'characters',
      message: 'Filename should not end with a dot (.) before the extension.',
    })
  }

  if (trimmedFilename.includes('..')) {
    errors.push({
      type: 'characters',
      message: 'Filename should not contain consecutive dots (..).',
    })
  }

  // Check for spaces (while valid, they can cause issues)
  if (trimmedFilename.includes(' ')) {
    errors.push({
      type: 'characters',
      message: 'Filename contains spaces. Consider using hyphens (-) or underscores (_) instead for better compatibility.',
    })
  }

  return errors
}

/**
 * Suggests a corrected filename based on validation errors
 */
export function suggestFilenameCorrection(filename: string): string {
  if (!filename)
    return 'workflow.yml'

  let corrected = filename.trim()

  // Remove path separators
  corrected = corrected.replace(/[/\\]/g, '-')

  // Replace invalid and discouraged characters with hyphens
  // eslint-disable-next-line no-control-regex
  corrected = corrected.replace(/[<>:"|?*\x00-\x1F\x7F#%&{}\\/$!'@+`=]/g, '-')

  // Replace spaces with hyphens
  corrected = corrected.replace(/\s+/g, '-')

  // Remove consecutive dots
  corrected = corrected.replace(/\.{2,}/g, '.')

  // Remove leading/trailing dots
  corrected = corrected.replace(/^\.+|\.+$/g, '')

  // Remove consecutive hyphens
  corrected = corrected.replace(/-{2,}/g, '-')

  // Remove leading/trailing hyphens
  corrected = corrected.replace(/^-+|-+$/g, '')

  // Ensure it has a valid extension
  const hasValidExtension = GITHUB_WORKFLOW_VALIDATION.validExtensions.some(ext =>
    corrected.toLowerCase().endsWith(ext),
  )

  if (!hasValidExtension) {
    // Remove any existing extension and add .yml
    corrected = `${corrected.replace(/\.[^.]*$/, '')}.yml`
  }

  // Ensure it's not empty
  if (!corrected || corrected === '.yml' || corrected === '.yaml') {
    corrected = 'workflow.yml'
  }

  // Truncate if too long
  if (corrected.length > GITHUB_WORKFLOW_VALIDATION.maxLength) {
    const extension = corrected.match(/\.(yml|yaml)$/i)?.[0] || '.yml'
    const nameLength = GITHUB_WORKFLOW_VALIDATION.maxLength - extension.length
    corrected = corrected.substring(0, nameLength) + extension
  }

  // Check for reserved names
  const nameWithoutExtension = corrected.replace(/\.(yml|yaml)$/i, '').toLowerCase()
  if (GITHUB_WORKFLOW_VALIDATION.reservedNames.includes(nameWithoutExtension)) {
    corrected = `${nameWithoutExtension}-workflow.yml`
  }

  return corrected
}

/**
 * Create a combined linter for CodeMirror
 */
export function combinedLinter(ajvValidate: any) {
  return (view: any) => {
    const diagnostics: Diagnostic[] = []
    const doc = view.state.doc.toString()

    try {
      // Validate YAML syntax
      const parsed = jsyaml.load(doc)
      if (!ajvValidate(parsed)) {
        ajvValidate.errors?.forEach((error: any) => {
          diagnostics.push({
            from: 0,
            to: 0,
            severity: 'error',
            message: `${error.instancePath} ${error.message}`,
          })
        })
      }
    }
    catch (e: any) {
      if (e.mark && typeof e.mark.line === 'number') {
        diagnostics.push({
          from: view.state.doc.line(e.mark.line + 1).from,
          to: view.state.doc.line(e.mark.line + 1).to,
          severity: 'error',
          message: e.message,
        })
      }
    }

    // Add security warnings as diagnostics
    const securityWarnings = getSecurityWarnings(doc)
    securityWarnings.forEach((warning) => {
      if (warning.line) {
        try {
          const line = view.state.doc.line(warning.line)
          diagnostics.push({
            from: line.from,
            to: line.to,
            severity: warning.severity === 'error' ? 'error' : 'warning',
            message: warning.message,
          })
        }
        catch (e) {
          // If line doesn't exist, add a general diagnostic
          diagnostics.push({
            from: 0,
            to: 0,
            severity: warning.severity === 'error' ? 'error' : 'warning',
            message: `${warning.field}: ${warning.message}`,
          })
          logger.error('WorkflowEditor', 'Error adding security warning diagnostic:', e)
        }
      }
    })

    return diagnostics
  }
}
