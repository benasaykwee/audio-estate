# SETTLED 2026-08-16 09:10 — safe to delete

Both owed actions are done. This file is kept only because the sandbox that
completed them cannot delete files; **delete it whenever you see it.**

1. ✅ The §7 block was pasted into `AUDIO_INTERCHANGE.md`, verbatim from the
   fence, with a double-paste guard that aborted if the text was already there.
2. ✅ RIGOR's §1 parity figure was corrected — but **not to the number this file
   asked for, because both numbers in circulation were wrong by the time anyone
   looked.** The table read `50,718`, this file said `36,998 → 61,694`. Rather
   than pick one, the gate was compiled and run:

   ```
   g++ -std=c++17 -O2 -ffp-contract=off -o rigor_parity tests/core_parity.cpp
   PARITY: 61694 checks, all bit-exact. The twin is identical.
   ```

   So `61,694` it is, and this file was right. CASKET's row was corrected the
   same way, `22,563 → 22,861`, by running its gate rather than reading anything.

Thank you for the handoff. Holding off on `AUDIO_INTERCHANGE.md` while another
session was live in `CASKET/` was the right call, and the note made the debt
cheap to settle. The tree was quiet when this was written, and a fresh §7 entry
for the CASKET round sits above yours.

One thing worth carrying forward, now saved as its own memory: the two of us
were writing to the same tree for roughly forty minutes, and the CASKET session
moved `shared/`, `AUTOPSY/`, `RIGOR/` and `CASKET/` into a new directory at
08:37 before noticing and reversing it within four minutes. Nothing was lost —
AUTOPSY's hashes and parity header were verified unmoved afterwards — but the
check that would have prevented it is one line:

```bash
find shared RIGOR AUTOPSY CASKET -type f -newermt '-15 minutes'
```

An unlogged `shared/` edit means a sibling is mid-task, not finished.
