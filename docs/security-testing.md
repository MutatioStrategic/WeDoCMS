# WeDoCMS security testing and release controls

This document defines the minimum security gates for WeDoCMS. These checks reduce risk; they do not prove that the system is vulnerability-free or that a malicious change is impossible. Production credentials must never be used by pull-request workflows.

## The 12 security test layers

1. **Threat modeling** — Review sensitive data, trust boundaries, attack paths, abuse cases, and mitigations using STRIDE or an equivalent method. Update the model when authentication, tenancy, payments, uploads, or external integrations change.
2. **Secure code review** — Review authentication, authorization, input validation, cryptography, logging, errors, deserialization, file handling, and dangerous APIs. Sensitive changes require two reviewers and an explanation for obfuscated or unexplained logic.
3. **SAST** — Run CodeQL and the project's type checks/tests to find injection, unsafe APIs, weak cryptography, permission errors, and other source-level defects.
4. **SCA** — Run dependency vulnerability and license checks, keep `package-lock.json` committed, and review dependency changes for malicious or unnecessary packages.
5. **Secret and backdoor scanning** — Scan the current tree and Git history for credentials, private keys, suspicious downloads, hidden admin paths, reverse shells, unexpected network calls, and obfuscated code.
6. **DAST** — Attack a local running application to test sessions, access control, injection, headers, file uploads, and exposed routes.
7. **API and authorization testing** — Verify tenant isolation, object-level authorization, privilege boundaries, CSRF protections, rate limits, and rejection of forged identity headers or tokens.
8. **Fuzz testing** — Send malformed JSON, oversized values, unexpected types, random identifiers, and invalid protocol data to parsers and API boundaries; fail on unhandled server errors or crashes.
9. **Dependency and supply-chain security** — Pin dependencies, generate an SBOM, review CI changes, use protected branches, prefer trusted registries, and sign commits and release artifacts where supported.
10. **Infrastructure and configuration testing** — Scan workflow files, Wrangler/Cloudflare configuration, containers, IAM, storage exposure, and deployment settings for insecure defaults or excessive privileges.
11. **Penetration testing** — Have an authorized tester assess the complete web, API, cloud, and network attack surface before launch and after material changes.
12. **Runtime and monitoring tests** — Verify security logs, alerts, backup restoration, incident response, account recovery, key rotation, and detection of unusual outbound traffic, new administrators, and unexpected binaries.

## Required repository and GitHub controls

- Protect the default branch and require pull requests.
- Require at least two reviewers for security-sensitive changes and require CODEOWNERS review.
- Require the security workflow and CI workflow to pass before merging.
- Do not give pull-request workflows access to production secrets.
- Use MFA, least privilege, short-lived credentials, and environment protection rules for deployments.
- Keep audit logging enabled for repository, CI/CD, deployment, and production changes.
- Generate and retain an SBOM for releases; monitor dependency advisories.
- Use signed commits and signed release artifacts when the signing infrastructure is configured.
- Prefer reproducible builds and verify the generated artifact before deployment.

## Exceptions

An exception must name the affected check, explain the risk, identify an owner, define an expiry date, and be approved by a repository administrator. Never bypass secret scanning for a real credential; revoke and rotate it first.
