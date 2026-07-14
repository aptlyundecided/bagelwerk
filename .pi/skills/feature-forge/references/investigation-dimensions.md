# Investigation Dimensions

A question bank organized by dimension. Use judgment — not every feature needs every dimension.
Pick the ones most relevant to the feature type and the user's context.

---

## Problem & Motivation
*Establish why this feature exists before designing how it works.*

- What problem does this solve? Who feels that problem?
- What happens today without this feature? What's the workaround?
- What's the trigger — why now, why this?
- How do we know when this feature has succeeded? What does "done" look like in practice?
- Is there a specific incident, request, or pain point that drove this?

---

## Scope & Boundaries
*Nail down what's in and what's explicitly out.*

- What is this feature NOT doing? (explicit exclusions prevent scope creep)
- What's the MVP vs. what's a "nice to have"?
- Are there related features that could be confused with this one?
- Does this feature have phases, or is it all-or-nothing?
- What existing functionality does this touch, extend, or replace?

---

## Users & Consumers
*Who interacts with this, and how?*

- Who uses this feature — human users, other services, agents, external systems?
- What does their interaction look like? (trigger, input, expected output)
- Are there different personas or roles with different needs?
- What does the user/consumer already know or expect?

---

## Systems & Interfaces
*What does this touch in the existing architecture?*

- What existing systems, services, or components does this feature interact with?
- What data does it read? From where?
- What data does it write or emit? To where?
- Does it introduce any new external dependencies?
- Does it change any existing interfaces, contracts, or APIs?
- What protocols or transports are involved? (HTTP, MQTT, OPC UA, AMQP, etc.)

---

## Data & State
*Understand the data model and state implications.*

- What is the shape of the data this feature operates on?
- Does this feature create, transform, or delete persistent state?
- Where does that state live? (DB, cache, file, in-memory, edge device)
- What are the consistency requirements? (eventual, strong, best-effort)
- What happens to existing data when this feature is introduced?

---

## Operational Concerns
*How does this behave in production?*

- What are the failure modes? What happens when something goes wrong?
- Does this need to be observable? What would we monitor or alert on?
- Are there performance requirements? (latency, throughput, volume)
- Does this need to handle partial failure or degraded states gracefully?
- Is there retry, backoff, or fail-fast breaker logic needed?
- Does this need to run at the edge, in the cloud, or both?

---

## Security & Access
*Who can do what, and what's protected?*

- Does this feature introduce new access control requirements?
- Does it handle sensitive data?
- Does it expose any new surface area (API endpoints, ports, topics)?
- Are there auth/authz implications?

---

## Constraints & Context
*What shapes the design space?*

- Are there existing patterns in the codebase this should follow?
- Are there technology constraints? (must use X, can't use Y)
- Are there team or timeline constraints that affect scope?
- Are there dependencies on other teams, features, or external changes?
- What's the deployment context? (Kubernetes, edge via ZEDEDA, on-prem, hybrid)

---

## Open Questions Prompts
*Use these to close out investigation before transitioning to design.*

- What's the one thing we still don't know that could most affect the design?
- Are we making any assumptions we haven't validated?
- Is there anything that needs a spike or prototype before we can design this confidently?
- Who else needs to be consulted before we commit to this design?
