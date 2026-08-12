---
name: Orval Zod compatibility
description: Generated API validation schemas require the workspace Zod major version to match the Orval generator output.
---

Keep the workspace Zod dependency on the same major version expected by the installed Orval release. Current Orval emits Zod 4 validators such as `z.int()`, which fail against Zod 3 even though generation itself succeeds.

**Why:** Code generation can appear successful while the chained library typecheck fails, leaving generated clients unusable.

**How to apply:** If codegen reports missing Zod validator methods, check the catalog version before changing generated files or route code.