/**
 * Enhanced Session Manager with proper timeout handling.
 * Handles session expiration, warning, extension, and user activity tracking.
 * Provides singleton access and callback subscription for session events.
 */

import { API_CONFIG } from '../../config/constants'
import { env } from '../../config/env'
import { logger } from '../logger'

/**
 * Information about the current session's validity and timing.
 */
export interface SessionInfo {
  /** Whether the session is currently valid. */
  isValid: boolean
  /** Timestamp (ms) when the session expires. */
  expiresAt: number
  /** Timestamp (ms) of last user activity. */
  lastActivity: number
  /** Whether a warning has been shown for this session. */
  warningShown: boolean
  /** Timestamp (ms) when the session was initially created. */
  createdAt: number
}

/**
 * Callback signature for session warning events.
 * @param minutesRemaining - Minutes left before session expiration.
 */
export interface SessionWarningCallback {
  (minutesRemaining: number): void
}

/**
 * Callback signature for session expiration events.
 */
export interface SessionExpiredCallback {
  (): void
}

/**
 * Callback signature for token validation events.
 */
export interface TokenValidationCallback {
  (): Promise<boolean>
}

/**
 * Singleton class for managing session timeout, warning, and expiration.
 * Tracks user activity, schedules warnings, and notifies subscribers.
 */
class SessionTimeoutManager {
  /** Singleton instance. */
  private static instance: SessionTimeoutManager
  /** Current session info, or null if not initialized. */
  private sessionInfo: SessionInfo | null = null
  /** Interval for periodic session checks. */
  private checkInterval: NodeJS.Timeout | null = null
  /** Interval for hourly session checks. */
  private hourlyCheckInterval: NodeJS.Timeout | null = null
  /** Registered callbacks for session warning events. */
  private warningCallbacks: Set<SessionWarningCallback> = new Set()
  /** Registered callbacks for session expiration events. */
  private expiredCallbacks: Set<SessionExpiredCallback> = new Set()
  /** Registered callback for token validation. */
  private tokenValidationCallback: TokenValidationCallback | null = null
  /** Whether the page is currently active/visible. */
  private isActive: boolean = true
  /** Timestamp of last user activity. */
  private lastUserActivity: number = Date.now()
  /** Throttle timer for user activity events. */
  private activityThrottle: NodeJS.Timeout | null = null
  /** Whether the session manager is initialized. */
  private isInitialized: boolean = false
  /** Timeout for session warning. */
  private warningTimeout: NodeJS.Timeout | null = null
  /** Timeout for session expiration. */
  private expirationTimeout: NodeJS.Timeout | null = null
  /** Maximum session duration in milliseconds (8 hours). */
  private readonly MAX_SESSION_DURATION = 8 * 60 * 60 * 1000
  /** Hourly check interval in milliseconds (1 hour). */
  private readonly HOURLY_CHECK_INTERVAL = 60 * 60 * 1000

  /**
   * Private constructor. Sets up listeners for user activity, visibility, and unload events.
   */
  private constructor() {
    this.setupActivityListeners()
    this.setupVisibilityListeners()
    this.setupBeforeUnloadHandler()
  }

  /**
   * Get the singleton instance of SessionTimeoutManager.
   */
  public static getInstance(): SessionTimeoutManager {
    if (!SessionTimeoutManager.instance) {
      SessionTimeoutManager.instance = new SessionTimeoutManager()
    }
    return SessionTimeoutManager.instance
  }

  /**
   * Set token validation callback
   */
  public setTokenValidationCallback(callback: TokenValidationCallback): void {
    this.tokenValidationCallback = callback
  }

  /**
   * Initialize session with timeout and start periodic checks.
   * Sets up sessionInfo and schedules warning/expiration.
   */
  public initializeSession(): void {
    try {
      const now = Date.now()
      const timeoutMs = env.session.timeoutMinutes * 60 * 1000

      // Validate timeout value
      if (timeoutMs <= 0 || timeoutMs > 24 * 60 * 60 * 1000) {
        logger.debug('SessionTimeoutManager', 'Invalid timeout value, using default 30 minutes')
        const defaultTimeoutMs = 30 * 60 * 1000
        this.sessionInfo = {
          isValid: true,
          expiresAt: now + defaultTimeoutMs,
          lastActivity: now,
          warningShown: false,
          createdAt: now,
        }
      }
      else {
        this.sessionInfo = {
          isValid: true,
          expiresAt: now + timeoutMs,
          lastActivity: now,
          warningShown: false,
          createdAt: now,
        }
      }

      this.lastUserActivity = now
      this.isInitialized = true
      this.startPeriodicCheck()
      this.startHourlyChecks()
      this.scheduleTimeouts()

      logger.debug('SessionTimeoutManager', 'Session initialized', {
        timeoutMinutes: env.session.timeoutMinutes,
        expiresAt: new Date(this.sessionInfo.expiresAt).toISOString(),
        maxSessionDuration: '8 hours',
      })
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to initialize session:', error)
      // Fallback initialization
      const now = Date.now()
      const fallbackTimeout = 30 * 60 * 1000
      this.sessionInfo = {
        isValid: true,
        expiresAt: now + fallbackTimeout,
        lastActivity: now,
        warningShown: false,
        createdAt: now,
      }
      this.lastUserActivity = now
      this.isInitialized = true
      this.startPeriodicCheck()
      this.startHourlyChecks()
      this.scheduleTimeouts()
    }
  }

  /**
   * Start hourly session checks for 8-hour limit enforcement
   */
  private startHourlyChecks(): void {
    try {
      this.stopHourlyChecks() // Clear any existing interval

      this.hourlyCheckInterval = setInterval(async () => {
        try {
          await this.performHourlyCheck()
        }
        catch (error) {
          logger.error('SessionTimeoutManager', 'Error in hourly check:', error)
        }
      }, this.HOURLY_CHECK_INTERVAL)

      logger.debug('SessionTimeoutManager', 'Hourly checks started', {
        intervalHours: 1,
      })
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to start hourly checks:', error)
    }
  }

  /**
   * Stop hourly session checks
   */
  private stopHourlyChecks(): void {
    try {
      if (this.hourlyCheckInterval) {
        clearInterval(this.hourlyCheckInterval)
        this.hourlyCheckInterval = null
      }
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error stopping hourly checks:', error)
    }
  }

  /**
   * Perform token validation and check 8-hour limit
   */
  private async performTokenValidation(): Promise<void> {
    try {
      if (!this.sessionInfo || !this.isInitialized) {
        return
      }

      const now = Date.now()
      const sessionAge = now - this.sessionInfo.createdAt

      // Check if session has exceeded 8 hours
      if (sessionAge >= this.MAX_SESSION_DURATION) {
        logger.debug('SessionTimeoutManager', 'Session exceeded 8 hours, forcing logout')
        this.forceLogout()
        return
      }

      // Validate token if callback is provided
      if (this.tokenValidationCallback) {
        logger.debug('SessionTimeoutManager', 'Validating token')
        const isValid = await this.tokenValidationCallback()

        if (!isValid) {
          logger.debug('SessionTimeoutManager', 'Token validation failed, forcing logout')
          this.forceLogout()
          return
        }

        // Token is valid, extend session
        this.extendSession()
        logger.debug('SessionTimeoutManager', 'Token validation successful, session extended')
      }
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error in token validation:', error)
      // On validation error, force logout for security
      this.forceLogout()
    }
  }

  /**
   * Force logout and redirect
   */
  private forceLogout(): void {
    logger.debug('SessionTimeoutManager', 'Forcing logout and clearing session')

    this.clearSession()
    this.notifyExpired()

    // Clear all storage
    try {
      sessionStorage.clear()
      localStorage.clear()
    }
    catch (error) {
      logger.debug('SessionTimeoutManager', 'Error clearing storage:', error)
    }

    // Redirect to login
    setTimeout(() => {
      window.location.href = `${API_CONFIG.API_BASE_URL_PATH}`
    }, 100)
  }

  /**
   * Schedule warning and expiration timeouts based on sessionInfo.
   */
  private scheduleTimeouts(): void {
    this.clearTimeouts()

    if (!this.sessionInfo)
      return

    const now = Date.now()
    const timeUntilExpiration = this.sessionInfo.expiresAt - now
    const warningTime = env.session.warningMinutes * 60 * 1000

    // Schedule warning timeout
    if (timeUntilExpiration > warningTime) {
      const timeUntilWarning = timeUntilExpiration - warningTime
      this.warningTimeout = setTimeout(() => {
        this.showSessionWarning()
      }, timeUntilWarning)
    }
    else if (timeUntilExpiration > 0) {
      setTimeout(() => this.showSessionWarning(), 100)
    }

    // Schedule expiration timeout
    if (timeUntilExpiration > 0) {
      this.expirationTimeout = setTimeout(() => {
        this.handleSessionExpiration()
      }, timeUntilExpiration)
    }
    else {
      setTimeout(() => this.handleSessionExpiration(), 100)
    }

    logger.debug('SessionTimeoutManager', 'Timeouts scheduled', {
      timeUntilExpiration: Math.floor(timeUntilExpiration / 1000),
      timeUntilWarning: Math.floor((timeUntilExpiration - warningTime) / 1000),
    })
  }

  /**
   * Clear any scheduled warning and expiration timeouts.
   */
  private clearTimeouts(): void {
    if (this.warningTimeout) {
      clearTimeout(this.warningTimeout)
      this.warningTimeout = null
    }
    if (this.expirationTimeout) {
      clearTimeout(this.expirationTimeout)
      this.expirationTimeout = null
    }
  }

  /**
   * Show session warning and notify all registered warning callbacks.
   */
  private showSessionWarning(): void {
    if (!this.sessionInfo || !this.sessionInfo.isValid)
      return

    const minutesRemaining = this.getMinutesRemaining()
    if (minutesRemaining > 0 && !this.sessionInfo.warningShown) {
      this.sessionInfo.warningShown = true
      this.notifyWarning(minutesRemaining)
      logger.debug('SessionTimeoutManager', 'Session warning shown', { minutesRemaining })
    }
  }

  /**
   * Handle session expiration, notify callbacks, and redirect if needed.
   */
  private handleSessionExpiration(): void {
    if (!this.sessionInfo)
      return

    logger.debug('SessionTimeoutManager', 'Session expired due to inactivity')

    this.sessionInfo.isValid = false
    this.clearTimeouts()
    this.stopPeriodicCheck()
    this.stopTokenValidation()

    // Notify all callbacks
    this.notifyExpired()

    // Force redirect to log in if no callbacks handled it
    setTimeout(() => {
      if (window.location.pathname !== `${API_CONFIG.API_BASE_URL_PATH}`) {
        logger.debug('SessionTimeoutManager', 'Force redirecting to login due to session expiration')
        window.location.href = `${API_CONFIG.API_BASE_URL_PATH}`
      }
    }, 1000)
  }

  /**
   * Extend session timeout on user activity and reschedule timeouts.
   */
  public extendSession(): void {
    try {
      if (!this.sessionInfo || !this.isInitialized)
        return

      const now = Date.now()
      const sessionAge = now - this.sessionInfo.createdAt

      // Don't extend if session has exceeded 8 hours
      if (sessionAge >= this.MAX_SESSION_DURATION) {
        logger.debug('SessionTimeoutManager', 'Cannot extend session, 8 hours exceeded')
        this.forceLogout()
        return
      }

      const timeoutMs = Math.min(env.session.timeoutMinutes * 60 * 1000, 24 * 60 * 60 * 1000)

      this.sessionInfo.expiresAt = now + timeoutMs
      this.sessionInfo.lastActivity = now
      this.sessionInfo.warningShown = false
      this.lastUserActivity = now

      // Reschedule timeouts with new expiration time
      this.scheduleTimeouts()

      logger.debug('SessionTimeoutManager', 'Session extended', {
        newExpiresAt: new Date(this.sessionInfo.expiresAt).toISOString(),
        sessionAge: Math.floor(sessionAge / (60 * 1000)),
      })
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to extend session:', error)
    }
  }

  /**
   * Check if the session is currently valid.
   * @returns True if valid, false if expired or not initialized.
   */
  public isSessionValid(): boolean {
    try {
      if (!this.sessionInfo || !this.isInitialized)
        return false

      const now = Date.now()
      const sessionAge = now - this.sessionInfo.createdAt

      // Check 8-hour limit
      if (sessionAge >= this.MAX_SESSION_DURATION) {
        logger.debug('SessionTimeoutManager', 'Session exceeded 8 hours')
        this.forceLogout()
        return false
      }

      const isValid = this.sessionInfo.isValid && now < this.sessionInfo.expiresAt

      if (!isValid && this.sessionInfo.isValid) {
        this.handleSessionExpiration()
      }

      return isValid
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error checking session validity:', error)
      return false
    }
  }

  /**
   * Get a copy of the current session info, or null if not initialized.
   */
  public getSessionInfo(): SessionInfo | null {
    try {
      return this.sessionInfo ? { ...this.sessionInfo } : null
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error getting session info:', error)
      return null
    }
  }

  /**
   * Get the number of minutes remaining until session expiration.
   * @returns Minutes remaining, or 0 if invalid.
   */
  public getMinutesRemaining(): number {
    try {
      if (!this.sessionInfo || !this.sessionInfo.isValid)
        return 0

      const now = Date.now()
      const remaining = this.sessionInfo.expiresAt - now
      return Math.max(0, Math.floor(remaining / (60 * 1000)))
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error calculating minutes remaining:', error)
      return 0
    }
  }

  /**
   * Get the number of seconds remaining until session expiration.
   * @returns Seconds remaining, or 0 if invalid.
   */
  public getSecondsRemaining(): number {
    try {
      if (!this.sessionInfo || !this.sessionInfo.isValid)
        return 0

      const now = Date.now()
      const remaining = this.sessionInfo.expiresAt - now
      return Math.max(0, Math.floor(remaining / 1000))
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error calculating seconds remaining:', error)
      return 0
    }
  }

  /**
   * Invalidate the session and stop all timers/callbacks.
   */
  public invalidateSession(): void {
    try {
      if (this.sessionInfo) {
        this.sessionInfo.isValid = false
      }
      this.clearTimeouts()
      this.stopPeriodicCheck()
      this.stopTokenValidation()

      logger.debug('SessionTimeoutManager', 'Session invalidated')
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error invalidating session:', error)
    }
  }

  /**
   * Clear all session state, callbacks, and timers.
   */
  public clearSession(): void {
    try {
      this.sessionInfo = null
      this.isInitialized = false
      this.clearTimeouts()
      this.stopPeriodicCheck()
      this.stopTokenValidation()
      this.warningCallbacks.clear()
      this.expiredCallbacks.clear()

      // Clear activity throttle
      if (this.activityThrottle) {
        clearTimeout(this.activityThrottle)
        this.activityThrottle = null
      }

      logger.debug('SessionTimeoutManager', 'Session cleared')
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error clearing session:', error)
    }
  }

  /**
   * Subscribe to session warning notifications.
   * @param callback - Function to call when warning is triggered.
   * @returns Unsubscribe function.
   */
  public onSessionWarning(callback: SessionWarningCallback): () => void {
    this.warningCallbacks.add(callback)
    return () => this.warningCallbacks.delete(callback)
  }

  /**
   * Subscribe to session expired notifications.
   * @param callback - Function to call when session expires.
   * @returns Unsubscribe function.
   */
  public onSessionExpired(callback: SessionExpiredCallback): () => void {
    this.expiredCallbacks.add(callback)
    return () => this.expiredCallbacks.delete(callback)
  }

  /**
   * Setup listeners for user activity to extend session on interaction.
   */
  private setupActivityListeners(): void {
    try {
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click', 'keydown', 'wheel']

      const handleActivity = () => {
        this.lastUserActivity = Date.now()
        if (this.sessionInfo && this.sessionInfo.isValid && this.isInitialized) {
          this.extendSession()
        }
      }

      // Throttle activity updates to avoid excessive calls
      const throttledHandler = () => {
        if (this.activityThrottle)
          return

        this.activityThrottle = setTimeout(() => {
          handleActivity()
          this.activityThrottle = null
        }, 1000)
      }

      events.forEach((event) => {
        try {
          document.addEventListener(event, throttledHandler, { passive: true })
        }
        catch (error) {
          logger.debug('SessionTimeoutManager', `Failed to add listener for ${event}:`, error)
        }
      })

      logger.debug('SessionTimeoutManager', 'Activity listeners setup complete')
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to setup activity listeners:', error)
    }
  }

  /**
   * Setup listeners for page visibility and window focus/blur to manage session state.
   */
  private setupVisibilityListeners(): void {
    try {
      const handleVisibilityChange = () => {
        try {
          const wasActive = this.isActive
          this.isActive = !document.hidden

          if (this.isActive && !wasActive) {
            logger.debug('SessionTimeoutManager', 'Page became visible, checking session')

            if (this.sessionInfo && this.isInitialized) {
              const now = Date.now()
              const sessionAge = now - this.sessionInfo.createdAt

              // Check 8-hour limit
              if (sessionAge >= this.MAX_SESSION_DURATION) {
                logger.debug('SessionTimeoutManager', 'Session exceeded 8 hours while page was hidden')
                this.forceLogout()
                return
              }

              // Check if session expired while page was hidden
              if (now >= this.sessionInfo.expiresAt) {
                logger.debug('SessionTimeoutManager', 'Session expired while page was hidden')
                this.handleSessionExpiration()
                return
              }

              // Check for excessive inactivity
              const timeSinceLastActivity = now - this.lastUserActivity
              const maxInactiveTime = env.session.timeoutMinutes * 60 * 1000

              if (timeSinceLastActivity > maxInactiveTime) {
                logger.debug('SessionTimeoutManager', 'Session expired due to inactivity while page was hidden')
                this.handleSessionExpiration()
              }
              else {
                this.extendSession()
              }
            }
          }
          else if (!this.isActive && wasActive) {
            logger.debug('SessionTimeoutManager', 'Page became hidden')
          }
        }
        catch (error) {
          logger.error('SessionTimeoutManager', 'Error in visibility change handler:', error)
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)

      const handleFocus = () => {
        try {
          if (!this.isActive) {
            this.isActive = true
            handleVisibilityChange()
          }
        }
        catch (error) {
          logger.error('SessionTimeoutManager', 'Error in focus handler:', error)
        }
      }

      const handleBlur = () => {
        try {
          this.isActive = false
        }
        catch (error) {
          logger.error('SessionTimeoutManager', 'Error in blur handler:', error)
        }
      }

      window.addEventListener('focus', handleFocus)
      window.addEventListener('blur', handleBlur)

      logger.debug('SessionTimeoutManager', 'Visibility listeners setup complete')
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to setup visibility listeners:', error)
    }
  }

  /**
   * Setup handler to save session state before page unload and restore on load.
   */
  private setupBeforeUnloadHandler(): void {
    try {
      window.addEventListener('beforeunload', () => {
        if (this.sessionInfo && this.isInitialized) {
          try {
            sessionStorage.setItem('session_state', JSON.stringify({
              expiresAt: this.sessionInfo.expiresAt,
              lastActivity: this.lastUserActivity,
              createdAt: this.sessionInfo.createdAt,
              savedAt: Date.now(),
            }))
          }
          catch (error) {
            logger.debug('SessionTimeoutManager', 'Failed to save session state on unload:', error)
          }
        }
      })

      // Check for saved session state on load
      try {
        const savedState = sessionStorage.getItem('session_state')
        if (savedState) {
          const parsed = JSON.parse(savedState)
          const now = Date.now()
          const sessionAge = now - parsed.createdAt

          // Check 8-hour limit
          if (sessionAge >= this.MAX_SESSION_DURATION) {
            logger.debug('SessionTimeoutManager', 'Saved session exceeded 8 hours')
            sessionStorage.removeItem('session_state')
            return
          }

          // If session was saved recently and hasn't expired, we can restore it
          if (parsed.expiresAt > now && (now - parsed.savedAt) < 60000) {
            this.lastUserActivity = parsed.lastActivity
            logger.debug('SessionTimeoutManager', 'Restored session state from previous page load')
          }

          sessionStorage.removeItem('session_state')
        }
      }
      catch (error) {
        logger.debug('SessionTimeoutManager', 'Failed to restore session state:', error)
      }
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to setup beforeunload handler:', error)
    }
  }

  /**
   * Start periodic session checking at configured interval.
   */
  private startPeriodicCheck(): void {
    try {
      this.stopPeriodicCheck()

      const intervalMs = Math.max(env.session.checkIntervalSeconds * 1000, 5000)

      this.checkInterval = setInterval(() => {
        try {
          this.performPeriodicCheck()
        }
        catch (error) {
          logger.error('SessionTimeoutManager', 'Error in periodic check:', error)
        }
      }, intervalMs)

      logger.debug('SessionTimeoutManager', 'Periodic check started')
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Failed to start periodic check:', error)
    }
  }

  /**
   * Stop periodic session checking.
   */
  private stopPeriodicCheck(): void {
    try {
      if (this.checkInterval) {
        clearInterval(this.checkInterval)
        this.checkInterval = null
      }
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error stopping periodic check:', error)
    }
  }

  /**
   * Perform a periodic check for session validity and warning threshold.
   */
  private performPeriodicCheck(): void {
    try {
      if (!this.sessionInfo || !this.isInitialized)
        return

      if (!this.isSessionValid()) {
        return
      }

      const minutesRemaining = this.getMinutesRemaining()
      const warningThreshold = Math.max(env.session.warningMinutes, 1)

      if (minutesRemaining <= warningThreshold && !this.sessionInfo.warningShown) {
        this.showSessionWarning()
      }

      logger.debug('SessionTimeoutManager', 'Periodic check completed', {
        minutesRemaining,
        isValid: this.sessionInfo.isValid,
        isActive: this.isActive,
      })
    }
    catch (error) {
      logger.error('SessionTimeoutManager', 'Error in periodic check:', error)
    }
  }

  /**
   * Notify all registered warning callbacks with minutes remaining.
   */
  private notifyWarning(minutesRemaining: number): void {
    this.warningCallbacks.forEach((callback) => {
      try {
        callback(minutesRemaining)
      }
      catch (error) {
        logger.error('SessionTimeoutManager', 'Error in warning callback:', error)
      }
    })
  }

  /**
   * Notify all registered expired callbacks.
   */
  private notifyExpired(): void {
    this.expiredCallbacks.forEach((callback) => {
      try {
        callback()
      }
      catch (error) {
        logger.error('SessionTimeoutManager', 'Error in expired callback:', error)
      }
    })
  }

  /**
   * Force session expiration (for testing or manual logout).
   */
  public forceExpiration(): void {
    logger.debug('SessionTimeoutManager', 'Forcing session expiration')
    this.handleSessionExpiration()
  }

  /**
   * Get detailed session status for debugging and diagnostics.
   */
  public getSessionStatus(): {
    isInitialized: boolean
    isValid: boolean
    minutesRemaining: number
    secondsRemaining: number
    isActive: boolean
    warningShown: boolean
    lastActivity: string
    expiresAt: string
    createdAt: string
    sessionAge: number
  } {
    const now = Date.now()
    return {
      isInitialized: this.isInitialized,
      isValid: this.sessionInfo?.isValid ?? false,
      minutesRemaining: this.getMinutesRemaining(),
      secondsRemaining: this.getSecondsRemaining(),
      isActive: this.isActive,
      warningShown: this.sessionInfo?.warningShown ?? false,
      lastActivity: new Date(this.lastUserActivity).toISOString(),
      expiresAt: this.sessionInfo ? new Date(this.sessionInfo.expiresAt).toISOString() : 'N/A',
      createdAt: this.sessionInfo ? new Date(this.sessionInfo.createdAt).toISOString() : 'N/A',
      sessionAge: this.sessionInfo ? Math.floor((now - this.sessionInfo.createdAt) / (60 * 1000)) : 0,
    }
  }
}

export const sessionTimeoutManager = SessionTimeoutManager.getInstance()
