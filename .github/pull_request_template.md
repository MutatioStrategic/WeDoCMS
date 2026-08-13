## Security review checklist

- [ ] Threat model reviewed or updated for this change.
- [ ] Authentication and authorization boundaries were tested.
- [ ] Input validation, output encoding, and error handling were reviewed.
- [ ] No secrets, private keys, or production data were added.
- [ ] Dependencies and workflow changes are necessary and trusted.
- [ ] Logging does not expose tokens, credentials, personal data, or presigned URLs.
- [ ] Tests cover negative and unauthorized cases.
- [ ] DAST, fuzzing, penetration testing, or an exception is documented when applicable.

## Change summary

<!-- Describe what changed, why, and how it was validated. -->
