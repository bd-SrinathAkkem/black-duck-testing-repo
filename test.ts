export function parseYamlAndUpdateVariables(yamlString: string): void {
  try {
    // Basic YAML parsing to extract GitHub expressions
    const lines = yamlString.split('\n')
    const extractedVariables = {
      env: {} as Partial<DynamicVariableMapping>,
      secrets: {} as Partial<DynamicVariableMapping>,
      github: {} as Partial<DynamicVariableMapping>,
      bridgeCli: {} as Partial<DynamicVariableMapping>,
    }

    lines.forEach((line) => {
      const trimmedLine = line.trim()
      if (trimmedLine.includes('${{')) {
        // Extract GitHub expressions from YAML
        const matches = trimmedLine.match(/\$\{\{[^}]+\}\}/g)
        if (matches) {
          matches.forEach((match) => {
            console.log(`match: ${match}`) // Debugging output
            // Categorize and update based on pattern
            if (match.includes('vars.') && match.includes('BLACKDUCKSCA') && match.includes('URL')) {
              extractedVariables.env.BLACKDUCKSCA_URL = match
            }
            else if (match.includes('vars.') && match.includes('COVERITY') && match.includes('URL')) {
              extractedVariables.env.COVERITY_URL = match
            }
            else if (match.includes('vars.') && match.includes('POLARIS') && match.includes('URL')) {
              extractedVariables.env.POLARIS_URL = match
            }
            else if (match.includes('secrets.') && match.includes('BLACKDUCKSCA') && match.includes('TOKEN')) {
              extractedVariables.secrets.BLACKDUCKSCA_TOKEN = match
            }
            else if (match.includes('secrets.') && match.includes('COVERITY') && match.includes('PASSPHRASE')) {
              extractedVariables.secrets.COVERITY_PASSPHRASE = match
            }
            else if (match.includes('secrets.') && match.includes('COVERITY') && match.includes('USER')) {
              extractedVariables.secrets.COVERITY_USER = match
            }
            else if (match.includes('secrets.') && match.includes('POLARIS') && match.includes('TOKEN')) {
              extractedVariables.secrets.POLARIS_ACCESS_TOKEN = match
            }
            else if (match.includes('secrets.') && match.includes('GITHUB') && match.includes('TOKEN')) {
              extractedVariables.secrets.GITHUB_TOKEN = match
              extractedVariables.env.GITHUB_TOKEN = match
            }
            else if (match.includes('vars.') && match.includes('BRIDGECLI') && match.includes('LINUX')) {
              extractedVariables.bridgeCli.LINUX64 = match
            }
            else if (match.includes('vars.') && match.includes('BRIDGECLI') && match.includes('WIN')) {
              extractedVariables.bridgeCli.WIN64 = match
            }
            else if (match.includes('runner.temp')) {
              extractedVariables.bridgeCli.RUNNER_TEMP = match
            }
            else if (match.includes('github.event.repository.name')) {
              extractedVariables.github.APPLICATION_NAME = match
              extractedVariables.github.PROJECT_NAME = match
            }
            else if (match.includes('github.event.ref_name') || match.includes('github.ref_name')) {
              extractedVariables.github.BRANCH_NAME = match
            }
          })
        }
      }
    })

    // Update the variable mappings
    updateDefaultVariables(extractedVariables)
    logger.info('Workflow', 'Updated variable mappings from YAML:', extractedVariables)
  }
  catch (error) {
    logger.error('Workflow', 'Error parsing YAML and updating variables:', error)
  }
}
