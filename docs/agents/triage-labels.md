# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker. This repo only uses two of them — a solo project with one agent working one issue at a time has no reporter to wait on and no triage queue.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| --------------------------- | --------------------- | ----------------------------------------- |
| `needs-triage`              | — not used             | Maintainer needs to evaluate this issue  |
| `needs-info`                | — not used             | Waiting on reporter for more information |
| `ready-for-agent`           | `ready-for-agent`      | Fully specified, ready for an AFK agent  |
| `ready-for-human`           | `ready-for-human`      | Requires human implementation            |
| `wontfix`                   | — not used             | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table. Where the row says "not used", skip the labelling step rather than creating the label — closing the issue with a reason is how this repo says "wontfix".

Edit the right-hand column to match whatever vocabulary you actually use.
