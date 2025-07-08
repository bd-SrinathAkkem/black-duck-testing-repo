import type { WorkflowEditorHandle } from '../pages/workflow-yml/WorkflowEditor'
import * as jsyaml from 'js-yaml'
import { useCallback, useState } from 'react'
import * as React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfigStore } from '../stores/config-store'
import { useGithubStore } from '../stores/github-store'
import { useOrganizationStore } from '../stores/organization-store'
import { logger } from '../utils/logger'
import { sessionStorage } from '../utils/session/sessionStorage'
import { configToYaml } from '../utils/utils'

/**
 * Custom React hook to manage step-based navigation and workflow state in the multi-step wizard.
 *
 * Handles:
 * - Step navigation (next, previous, direct step click)
 * - Workflow YAML content generation and versioning
 * - State restoration and session persistence
 * - URL synchronization and browser navigation
 *
 * @returns {object} Navigation state and handlers for the workflow wizard
 */
export function useStepNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const { organizations } = useOrganizationStore()
  const {
    config,
    additionalYamlData,
    saveWorkflowVersion,
    getLatestWorkflowVersion,
    getVersion,
  } = useConfigStore()
  const {
    getWorkflowContent,
    setWorkflowContent,
    canStartNewFlow,
    getSubmissionStatus,
    hasPreservedState,
    getPreservedState,
    resetToInitialStateWithOrgPreservation,
  } = useGithubStore()

  /**
   * Initialized from session storage or URL query param.
   */
  const [currentStep, setCurrentStep] = useState(() => {
    // Try to restore step from session storage or URL
    const savedStep = sessionStorage.getCurrentStep()
    const urlStep = new URLSearchParams(location.search).get('step')
    const step = urlStep ? Number.parseInt(urlStep, 10) : savedStep || 1
    // Clamp step between 1 and 4
    return Math.max(1, Math.min(4, step))
  })

  /**
   * Ref to the workflow editor component, used for saving content from the editor.
   */
  const editorRef = React.useRef<WorkflowEditorHandle>(null)
  /**
   * Indicates if a navigation action is currently in progress.
   */
  const [isNavigating, setIsNavigating] = useState(false)
  /**
   * Tracks the last config version to detect changes and trigger saves.
   */
  const [lastConfigVersion, setLastConfigVersion] = useState(getVersion())

  /**
   * Generates the workflow YAML content from the current config and any additional YAML data.
   * Merges additional YAML data if present.
   * @returns {string} YAML string representing the workflow configuration
   */
  const generateWorkflowContentFromConfig = useCallback(() => {
    try {
      // Generate base YAML from config
      const baseYaml = configToYaml(config)

      // If we have additional YAML data, merge it into the base YAML object
      if (Object.keys(additionalYamlData).length > 0) {
        const yaml = jsyaml
        let yamlObj = yaml.load(baseYaml) as Record<string, unknown>
        yamlObj = { ...yamlObj, ...additionalYamlData }

        // Dump merged object back to YAML
        return yaml.dump(yamlObj, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        })
      }

      return baseYaml
    }
    catch (error) {
      logger.error('useStepNavigation', 'Error generating workflow content from config:', error)
      // Fallback to base config YAML if merge fails
      return configToYaml(config)
    }
  }, [config, additionalYamlData])

  /**
   * Saves the workflow content if needed, depending on the current step.
   * - On step 3: saves content from the editor (if available)
   * - On step 2: saves generated config-based content
   * @returns {Promise<boolean>} True if save succeeded or not needed, false if failed
   */
  const saveWorkflowIfNeeded = useCallback(async (): Promise<boolean> => {
    // If on step 3 and editor is present, save from editor
    if (currentStep === 3 && editorRef.current) {
      try {
        const saved = editorRef.current.save()
        if (!saved) {
          logger.debug('useStepNavigation', 'Failed to save workflow content from editor')
          return false
        }

        // Get the current workflow content from the editor
        const currentContent = getWorkflowContent()
        if (currentContent) {
          // Save this as a navigation-triggered version
          const versionNumber = saveWorkflowVersion(currentContent, 'navigation')
          logger.debug('useStepNavigation', 'Saved workflow content from navigation', {
            versionNumber,
            contentLength: currentContent.length,
          })
        }

        logger.debug('useStepNavigation', 'Workflow content saved successfully from editor')
        return true
      }
      catch (error) {
        logger.error('useStepNavigation', 'Error saving workflow content:', error)
        return false
      }
    }

    // On step 2, save config-based workflow content
    if (currentStep === 2) {
      const workflowContent = generateWorkflowContentFromConfig()
      const versionNumber = saveWorkflowVersion(workflowContent, 'navigation')
      setWorkflowContent(workflowContent)

      logger.debug('useStepNavigation', 'Saved config-based workflow content from step 2', {
        versionNumber,
        contentLength: workflowContent.length,
      })
    }

    // For other steps, no save needed
    return true
  }, [currentStep, saveWorkflowVersion, getWorkflowContent, setWorkflowContent, generateWorkflowContentFromConfig])

  /**
   * Loads the latest workflow content into the editor/store when entering step 3.
   * If no previous versions exist, generates content from the current config.
   */
  const loadLatestWorkflowContent = useCallback(() => {
    // Only act if entering step 3
    if (currentStep === 3) {
      const latestVersion = getLatestWorkflowVersion()
      if (latestVersion) {
        logger.debug('useStepNavigation', 'Loading latest workflow version for step 3', {
          version: latestVersion.version,
          source: latestVersion.source,
          contentLength: latestVersion.workflowContent.length,
        })

        setWorkflowContent(latestVersion.workflowContent)
      }
      else {
        // No versions exist, generate from current config
        const workflowContent = generateWorkflowContentFromConfig()
        const versionNumber = saveWorkflowVersion(workflowContent, 'config')
        setWorkflowContent(workflowContent)

        logger.debug('useStepNavigation', 'No workflow versions found, created initial version', {
          versionNumber,
          contentLength: workflowContent.length,
        })
      }
    }
  }, [currentStep, getLatestWorkflowVersion, setWorkflowContent, generateWorkflowContentFromConfig, saveWorkflowVersion])

  /**
   * Restores preserved state (e.g., organization/repo selection) if available when entering step 1.
   * Used to support resuming interrupted flows or starting a new flow after submission.
   */
  const handlePreservedStateRestoration = useCallback(() => {
    if (currentStep === 1 && hasPreservedState()) {
      const preservedState = getPreservedState()
      if (preservedState) {
        logger.debug('useStepNavigation', 'Restoring preserved state on step 1', {
          preservedOrgName: preservedState.stepOne.organization?.name,
          preservedRepoCount: preservedState.stepOne.selectedRepos.length,
        })

        // Restore the preserved state to initial state with org preservation
        resetToInitialStateWithOrgPreservation()
      }
    }
  }, [currentStep, hasPreservedState, getPreservedState, resetToInitialStateWithOrgPreservation])

  /**
   * Handles direct navigation to a specific step (e.g., when a step is clicked in the UI).
   * - Prevents navigation if already navigating or clicking the current step
   * - Checks for organization data before allowing navigation
   * - Handles special logic for resuming after submission
   * - Saves workflow content as needed before navigating
   * - Loads latest workflow content or restores preserved state when appropriate
   * @param {number} stepId - The step to navigate to (1-4)
   */
  const handleStepClick = useCallback(async (stepId: number) => {
    if (isNavigating || stepId === currentStep)
      return

    // Check if we have organizations before allowing navigation
    if (!organizations || organizations.length === 0) {
      logger.debug('useStepNavigation', 'Step navigation blocked - no organizations available')
      return
    }

    // Enhanced handling for submission completion and new flow
    const isSubmitted = getSubmissionStatus()
    const canStartNew = canStartNewFlow()

    if (currentStep === 4 && isSubmitted && canStartNew && stepId < 4) {
      logger.debug('useStepNavigation', 'Allowing navigation from completed submission to start new flow', {
        from: currentStep,
        to: stepId,
        hasPreservedState: hasPreservedState(),
      })

      // If navigating back from completed submission, handle preserved state
      if (stepId === 1) {
        handlePreservedStateRestoration()
      }
    }

    setIsNavigating(true)

    try {
      logger.debug('useStepNavigation', 'Step clicked', { from: currentStep, to: stepId })

      // Save workflow content if coming from step 3
      const saveSuccess = await saveWorkflowIfNeeded()
      if (!saveSuccess) {
        setIsNavigating(false)
        return
      }

      // Clamp step to valid range
      const targetStep = Math.max(1, Math.min(4, stepId))
      setCurrentStep(targetStep)

      // Load latest content when entering step 3
      if (targetStep === 3) {
        // Use setTimeout to ensure state is updated before loading content
        setTimeout(() => {
          loadLatestWorkflowContent()
        }, 0)
      }

      // Handle preserved state restoration when entering step 1
      if (targetStep === 1) {
        setTimeout(() => {
          handlePreservedStateRestoration()
        }, 0)
      }
    }
    catch (error) {
      logger.error('useStepNavigation', 'Error during step navigation:', error)
    }
    finally {
      setIsNavigating(false)
    }
  }, [currentStep, isNavigating, organizations, saveWorkflowIfNeeded, loadLatestWorkflowContent, getSubmissionStatus, canStartNewFlow, handlePreservedStateRestoration])

  /**
   * Handles navigation to the previous step in the wizard.
   * - Prevents navigation if already navigating or at the first step
   * - Checks for organization data before allowing navigation
   * - Saves workflow content as needed before navigating
   * - Loads latest workflow content or restores preserved state when appropriate
   */
  const handlePrevious = useCallback(async () => {
    if (isNavigating || currentStep <= 1)
      return

    // Check if we have organizations before allowing navigation
    if (!organizations || organizations.length === 0) {
      logger.debug('useStepNavigation', 'Previous navigation blocked - no organizations available')
      return
    }

    setIsNavigating(true)

    try {
      logger.debug('useStepNavigation', 'Moving to previous step', { from: currentStep, to: currentStep - 1 })

      // Save workflow content if coming from step 3
      const saveSuccess = await saveWorkflowIfNeeded()
      if (!saveSuccess) {
        setIsNavigating(false)
        return
      }

      const targetStep = Math.max(1, currentStep - 1)
      setCurrentStep(targetStep)

      // Load latest content when entering step 3
      if (targetStep === 3) {
        setTimeout(() => {
          loadLatestWorkflowContent()
        }, 0)
      }

      // Handle preserved state restoration when entering step 1
      if (targetStep === 1) {
        setTimeout(() => {
          handlePreservedStateRestoration()
        }, 0)
      }
    }
    catch (error) {
      logger.error('useStepNavigation', 'Error during previous navigation:', error)
    }
    finally {
      setIsNavigating(false)
    }
  }, [currentStep, isNavigating, organizations, saveWorkflowIfNeeded, loadLatestWorkflowContent, handlePreservedStateRestoration])

  /**
   * Handles navigation to the next step in the wizard.
   * - Prevents navigation if already navigating or at the last step
   * - Checks for organization data before allowing navigation
   * - Saves workflow content as needed before navigating
   * - Loads latest workflow content when appropriate
   */
  const handleNext = useCallback(async () => {
    if (isNavigating || currentStep >= 4)
      return

    // Check if we have organizations before allowing navigation
    if (!organizations || organizations.length === 0) {
      logger.debug('useStepNavigation', 'Next navigation blocked - no organizations available')
      return
    }

    setIsNavigating(true)

    try {
      logger.debug('useStepNavigation', 'Moving to next step', { from: currentStep, to: currentStep + 1 })

      // Save workflow content if coming from step 3
      const saveSuccess = await saveWorkflowIfNeeded()
      if (!saveSuccess) {
        setIsNavigating(false)
        return
      }

      const targetStep = Math.min(4, currentStep + 1)
      setCurrentStep(targetStep)

      // Load latest content when entering step 3
      if (targetStep === 3) {
        setTimeout(() => {
          loadLatestWorkflowContent()
        }, 0)
      }
    }
    catch (error) {
      logger.error('useStepNavigation', 'Error during next navigation:', error)
    }
    finally {
      setIsNavigating(false)
    }
  }, [currentStep, isNavigating, organizations, saveWorkflowIfNeeded, loadLatestWorkflowContent])

  // Monitor config changes and save workflow versions
  /**
   * Effect: Watches for config version changes and saves a new workflow version if needed.
   * Avoids infinite loops by checking version numbers.
   */
  React.useEffect(() => {
    const currentConfigVersion = getVersion()

    // Only save if config version has changed (avoid infinite loops)
    if (currentConfigVersion !== lastConfigVersion && currentConfigVersion > 0) {
      logger.debug('useStepNavigation', 'Config version changed, saving workflow version', {
        oldVersion: lastConfigVersion,
        newVersion: currentConfigVersion,
        currentStep,
      })

      // Generate workflow content from current config
      const workflowContent = generateWorkflowContentFromConfig()

      // Save the new workflow version
      const versionNumber = saveWorkflowVersion(workflowContent, 'config')

      // Update the GitHub store with the latest content
      setWorkflowContent(workflowContent)

      setLastConfigVersion(currentConfigVersion)

      logger.debug('useStepNavigation', 'Saved workflow version from config change', {
        versionNumber,
        contentLength: workflowContent.length,
      })
    }
  }, [getVersion(), lastConfigVersion, saveWorkflowVersion, setWorkflowContent, currentStep])

  // Update URL when step changes
  /**
   * Effect: Updates the URL query parameter and session storage when the step changes.
   * Keeps browser history clean by replacing the URL instead of pushing.
   */
  React.useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const currentUrlStep = searchParams.get('step')

    if (currentUrlStep !== currentStep.toString()) {
      searchParams.set('step', currentStep.toString())
      const newUrl = `${location.pathname}?${searchParams.toString()}`

      // Use replace to avoid creating history entries for step changes
      navigate(newUrl, { replace: true })
    }

    // Save step to session storage
    sessionStorage.setCurrentStep(currentStep)
  }, [currentStep, location.pathname, location.search, navigate])

  // Handle browser back/forward navigation
  /**
   * Effect: Handles browser back/forward navigation (popstate) to sync step state.
   * Loads workflow content or restores preserved state as needed.
   */
  React.useEffect(() => {
    const handlePopState = () => {
      const urlStep = new URLSearchParams(window.location.search).get('step')
      if (urlStep) {
        const step = Math.max(1, Math.min(4, Number.parseInt(urlStep, 10)))
        if (step !== currentStep) {
          setCurrentStep(step)

          // Load latest content when entering step 3 via browser navigation
          if (step === 3) {
            setTimeout(() => {
              loadLatestWorkflowContent()
            }, 0)
          }

          // Handle preserved state restoration when entering step 1 via browser navigation
          if (step === 1) {
            setTimeout(() => {
              handlePreservedStateRestoration()
            }, 0)
          }
        }
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [currentStep, loadLatestWorkflowContent, handlePreservedStateRestoration])

  // Load latest content when initially entering step 3
  /**
   * Effect: Loads latest workflow content when initially entering step 3.
   */
  React.useEffect(() => {
    if (currentStep === 3) {
      loadLatestWorkflowContent()
    }
  }, [currentStep, loadLatestWorkflowContent])

  // NEW: Handle preserved state restoration when initially entering step 1
  /**
   * Effect: Handles preserved state restoration when initially entering step 1.
   */
  React.useEffect(() => {
    if (currentStep === 1) {
      handlePreservedStateRestoration()
    }
  }, [currentStep, handlePreservedStateRestoration])

  // Cleanup on unmount
  /**
   * Effect: Cleanup on unmount. Resets navigation state.
   */
  React.useEffect(() => {
    return () => {
      setIsNavigating(false)
    }
  }, [])

  return {
    currentStep,
    isNavigating,
    handleStepClick,
    handlePrevious,
    handleNext,
    editorRef,
  }
}
