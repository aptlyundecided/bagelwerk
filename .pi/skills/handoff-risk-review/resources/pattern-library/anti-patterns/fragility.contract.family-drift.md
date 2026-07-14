---
id: fragility.contract.family-drift
title: Sibling contract bundles in the same family drift in recovery, observability, or precision
tier: mechanical
---

# Anti-pattern: contract-family drift across sibling surfaces

## Symptom

- Two or more sibling skills belong to the same contract family.
- One bundle documents richer recovery posture, structural states, observability, or normalization precedence than another.
- The implementation family may be converging, but the review surface is not.

## Why it hurts

- Similar handoffs stop being reviewable by the same rubric.
- Operators and future authors get inconsistent expectations for nearly identical surfaces.
- Real anti-fragility improvements can land in code without becoming durable contract knowledge.

## Review questions

- Do sibling bundles describe the same structural-state taxonomy?
- Does one bundle document recovery / normalization precedence while another omits it?
- Is the divergence intentional and justified, or just accumulated drift?
- Would a shared contract extraction make the family more coherent?

## Related runtime notes

Observed in `behavior-extraction-ralph` when revision and sufficiency bundles were thinner than their sibling revision / sufficiency families despite similar runtime hardening needs.
