# Resume behavior

Owns opt-in accepted-output resume checks.

## Includes

- Detecting accepted selections for a resolved Node path.
- Verifying required accepted artifacts exist.
- Producing skipped run-tree nodes for resume hits.

## Invariants

- Resume is opt-in and accepted-output based.
- Resume should not silently synthesize success unless accepted selection and required artifacts exist.
