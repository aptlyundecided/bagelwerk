# structured output repair

A prior agent-backed step produced JSON that failed strict schema validation. Your job is to
**triage** the failure and, when safe, **repair** the output — without inventing data.

## Input

Read the staged `repair-context.md`. It contains:

- the **validation issues** (exactly what the schema rejected), and
- the **failing output** (the JSON the prior step produced).

## Decide: repair or rerun

- Choose **`repair`** only when the correct information is **already present** in the failing
  output and the problem is purely structural — e.g. a wrong enum casing/synonym (`"moderate"` →
  `"medium"`), a missing mechanical field that can be derived (an id), stray/extra fields, wrong
  nesting, a value that should be an array but is a string.
- Choose **`rerun`** when a **required field's content is genuinely missing** (no evidence, no
  summary, no findings) — anything you would have to make up. Do **not** fabricate values to
  satisfy the schema. When in doubt, choose `rerun`.

## Output

Publish exact JSON as `structured-output-repair.json` using response block
`structured-output-repair-json`:

```json
{
  "action": "repair",
  "json": { "...": "the corrected object, reshaped from the present data only" }
}
```

or, when the data is genuinely insufficient:

```json
{ "action": "rerun" }
```

Rules:

- Reshape/relabel/normalise only — never invent field *values*.
- Preserve all real content (titles, summaries, evidence, confidence) exactly; only fix structure.
- `json` must be the full corrected object the original contract expects, not a diff.
