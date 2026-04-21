# Rapidfort hardening profile — files to preserve (gitignore syntax)
#
# Context: rfharden replaces .py source files with stubs when the corresponding
# code path is not exercised during rfstub workload profiling. Because our smoke
# test does not (yet) cover every router / service branch — notably admin vs
# non-admin code paths in grant_collector.py — we protect the entire /app
# tree to guarantee runtime correctness regardless of profile coverage.
#
# Long-term: strengthen smoke tests to hit every code path and narrow this
# scope. See issue: "Phase 2: strengthen Rapidfort smoke test coverage".

# Preserve all application code (Python source + frontend static build output)
/app/**
