# Engineering lessons learned

## Why fundamental gaps surfaced late

The late discovery of basic gaps was not caused by one factor. Model quality
may have contributed, but the larger cause was the development workflow: we
allowed broad functionality to accumulate before proving a small, complete
user journey and its boundaries.

The pattern was:

> local implementation success → accumulated assumptions → more functionality
> → cross-feature contradictions → discovery of foundational gaps

AI-assisted development makes this easier to miss. A model can produce code
that is locally plausible while accepting existing patterns, implementing only
the requested happy path, or failing to challenge unstated assumptions about
authentication, tenancy, persistence, accessibility, failure states, and API
contracts. A stronger model would reduce some reasoning and code-quality
mistakes, but it would not reliably compensate for missing acceptance criteria,
incomplete repository context, or weak validation gates.

The primary lesson is therefore process-oriented rather than model-oriented.
We should not treat a feature as understood merely because its visible path
works. The surrounding actor, surface, authority, tenant boundary, retry
semantics, unavailable-backend behavior, and evidence requirements must be
explicit before expanding the feature.

## Contributing causes

- Requirements and invariants were sometimes implicit instead of written down.
- Multiple features were developed before one vertical slice was demonstrated
  end to end.
- Tests sometimes followed implementation instead of defining observable
  behavior through the public interface first.
- Shared rules and contracts were discovered only after additional callers
  exposed inconsistencies.
- Happy paths received more attention than loading, empty, error, retry,
  unauthorized, and backend-unavailable states.
- Early adversarial review did not consistently ask what the implementation was
  assuming about identity, rights, storage, or ownership.

## Corrective working method

For each meaningful change:

1. Map the relevant surface, actor, journey, callers, persistence, and
   authoritative boundary before editing.
2. Write the key invariants and acceptance scenarios, including failure and
   unavailable states.
3. Build one tracer-bullet behavior through the real public seam.
4. Add regression coverage before broadening the implementation.
5. Check tenant isolation, authorization, idempotent retry, accessibility,
   mobile reflow, and contract consistency while the slice is still small.
6. Record the root cause and the guardrail that would have prevented the issue.

This is the practical role of a stronger model: it should help execute and
challenge this loop, not replace it. The project guardrails in `AGENTS.md` and
the vertical-slice acceptance criteria in `docs/rebuild-fix-plan.md` are the
operational form of this lesson.
