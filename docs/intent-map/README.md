# Bagelwerk intent map

Open [intent-map.html](intent-map.html) in a browser after cloning or downloading it. GitHub displays HTML source rather than the interactive page.

This self-contained graph-smith view contains 15 agreed intents and 14 parent-to-child relationships. Click a node for its full statement and open questions. Toggle Focus to isolate a node and its neighbors; use search to find labels, and `0` to fit the map.

[graph.json](graph.json) is the editable graph-smith input. The snapshot was exported from Infinity Crew’s saved Bagelwerk intents on November 12, 2026; node IDs preserve the original intent IDs. Arrows mean “refined by,” not execution order. Endorsed means agreed intent, not verified implementation. Outcome classification and type-specific handling remain deferred.

For implementation and test links, see [intent contracts](../../src/core/flow-runner/intent-contracts.md).

The HTML is intentionally checked in as a portable documentation view. It is a snapshot, not a live database connection. To refresh it, export the latest intents into the same graph-smith diagram schema and render with graph-smith’s diagram-build tooling. No graph-smith dependency is required to view the saved HTML.
