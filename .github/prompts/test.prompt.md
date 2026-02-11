---
agent: agent
description: Run the memory-mcp test suite to verify all tools work correctly
---

# memory-mcp Test Suite

Execute all tests in sequence and report results.

## Instructions

1. Call `list_knowledge` — verify empty or note existing files
2. Call `save_memory` with category="test", name="sample.md", content="# Test\n\nSearchable test content."
3. Call `read_memory` with path="test/sample.md" — verify content matches
4. Call `search_memory` with query="searchable" — verify results include test/sample.md
5. Call `list_knowledge` — verify test category and file appear
6. Call `delete_memory` with path="test/sample.md"
7. Call `list_knowledge` — verify test file is gone

## Output

Report each step as:
- ✓ Step N: [tool] — passed
- ✗ Step N: [tool] — failed: [reason]

End with summary: "X/7 tests passed"
