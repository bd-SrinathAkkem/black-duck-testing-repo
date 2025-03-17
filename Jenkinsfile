node {
    checkout scm
    stage("synopsys-security-scan") {
      synopsys_scan product: "blackduck"
          blackduck_reports_sarif_create: true,
        
    }
}
