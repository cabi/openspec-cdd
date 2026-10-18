# Spec Delta

## Purpose

<!-- New capabilities only, 1-2 sentences (50+ characters): what this
     capability is for. Omit for deltas against an existing capability. -->

## ADDED Requirements

<!-- One behavior per requirement. Description under 500 characters, SHALL/MUST
     wording, at least one #### Scenario per requirement.

     Quantify everything: "every 14 days", not "bi-weekly"; "p95 under 200 ms",
     not "fast"; "3 retries", not "several". A scenario is a test case: WHEN
     states the exact trigger, THEN the exactly observable outcome. -->

### Requirement: <name>

The system SHALL <exactly one observable behavior with numbers and units>.

#### Scenario: <name>

- **WHEN** <exact trigger or input>
- **THEN** <exactly observable outcome>
- **Verified by** tests/acceptance/<capability>.<scenario>.test.ts

<!-- After the requirements, end the file with Code lines (one per line, bare,
     not bullets) naming the files this capability owns - the drift guard
     matches them for staleness (L2) and single-owner (O) checks:

     Code: src/<capability>/**
