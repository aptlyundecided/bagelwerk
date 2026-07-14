# Resolution-time execution policy overlays

Owns application of run overlays to resolved Flow boundaries and Nodes.

## Includes

- Validating overlay path keys against resolved Flow boundary paths.
- Applying global overlay policy.
- Applying path-specific overlay policy from root to leaf.
- Copying effective boundary policy down to contained Nodes.

## Invariants

- Flow-authored policy is inherited during flattening; run overlays are applied after all boundaries are known.
- Overlay source history is preserved through `executionPolicySources`.
