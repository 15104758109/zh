# ZongHeng Narrative Engine

<p align="center">
  <a href="./README.md">简体中文</a> | <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Stage-Design--Complete-success?style=for-the-badge&logo=github" alt="Stage">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/Architecture-6--Layers-orange?style=for-the-badge" alt="Architecture">
</p>

> **An AI narrative engine for million-word novels that stay on track.**
>
> Let characters come alive in their world first, then turn what happens into a novel.

---

## Six Engineering Disasters in Traditional AI Writing

If you have used AI to write fiction, you have probably encountered these problems:

| Problem | What traditional AI writing looks like |
|---|---|
| **Character breakdown** | Characters drift far from their established behavior in later chapters; the AI no longer knows what they should do, and their sensory perspective does not develop. |
| **Setting contamination** | With too much reference material, settings, plot points, and hooks are dropped; with too little, the model invents at random and contradicts the world's rules. |
| **Plot drift** | Without long-term commitments, the main plot wanders, promised hooks are not delivered, and a detailed outline gives away too much. |
| **Broken foreshadowing** | Different AI analyses use different foreshadowing standards, so payoffs become inconsistent and both authors and readers forget the setup. |
| **Uncontrolled quality** | It is unclear what the author actually wants: short prompts produce weak results, while long prompts leave the model no room to create. |
| **AI toolification** | The workflow is good for stitching and dissecting material, but not for authors whose ideas need to be expanded with imagination. |

**The root cause is not a weak model. It is the lack of a narrative engineering system.**

---

## The Solution: A Controlled Industrial Production Pipeline

ZongHeng applies engineering discipline to fiction production. It builds a **controlled pipeline** instead of asking AI to write prose directly:

```
Your creative intent
    |
    v
+------------+    +------------+    +------------+    +------------+    +------------+
| Plot       |--->| Character  |--->| Layered    |--->| Formal     |--->| Literary   |
| contract   |    | conflict   |    | audits     |    | commit     |    | rendering  |
| (L1A)      |    | (simulation)|   | (QA)       |    | (truth)    |    | (effect)   |
+------------+    +------------+    +------------+    +------------+    +------------+
    |                 |                 |                 |                |
    v                 v                 v                 v                v
+What must happen   Characters act   Facts, logic,    Seven storage  Render from
 What must not      from motives     and OOC checks   atoms update   scene affordances
 The bottom card   in blind spots   Failed -> retry  SQL constraints Remove AI fingerprints
 stays hidden      Director picks   before commit    roll back all  Add the final polish
-------------------------------------------------------------------------------
 PostgreSQL truth layer: settings, state changes, and foreshadowing ledgers are enforced in SQL
-------------------------------------------------------------------------------
```

**The key difference**: AI first simulates who did what and why as structured records. Only after audits pass does a literary renderer turn those records into prose.

---

## Why Is It More Reliable Than Existing Tools?

| Dimension | Mainstream AI novel tools | ZongHeng Engine |
|---|---|---|
| Setting management | A Story Bible that AI references but does not have to obey | **A truth layer plus a physical circuit breaker**: the database rejects writes until audits pass |
| Character consistency | Character cards suggested in a prompt | **A four-layer ontology**: behavior follows philosophical limits, desires, fears, and resource constraints |
| Plot control | Outlines and beats that AI can ignore | **An L1A mid-range contract**: must-happen, must-not-happen, and strategic whitespace are enforced |
| Foreshadowing | Random extraction or AI entries that are easy to forget | **An asset lifecycle**: setup and payoff are tracked in each L1A unit alongside reader memory strength |
| Generation | Direct prose generation, mixing structure and writing | **Simulation JSON -> prose rendering**: the director and supporting characters shape choices without changing the structure |
| Quality assurance | The author and an AI tool fix problems manually | **Objective audits, editor routing, and enhancement editing**: the system becomes more automated over time |
| Failure handling | Rewrite or undo based on experience | **An internal retry loop -> fuse -> learned optimization samples**: shadow versions and failure samples become reusable knowledge |

---

## Alignment with the State of the Art

ZongHeng is not designed in isolation. Each core mechanism aligns with leading research, while combining those individual capabilities into a complete production protocol:

| Research direction | Representative work | ZongHeng equivalent |
|---|---|---|
| Dynamic outlining and memory augmentation | DOME | L1A, three-line ordering, and truth-layer writes: a contract-to-engineering decomposition rather than an outline-to-beat sheet |
| Multi-agent character simulation | Multi-Agent Character Simulation | Simulation JSON, director convergence, and prose isolation: independent personalities in a controlled chat |
| Knowledge-graph storytelling | CreAgentive | World atoms, information particles, and an asset state machine: a game-world renderer rather than an AI summary |
| Quantum mechanics | The Fifth Dimension | A multi-objective director chooses the truth: destiny is arranged beyond the characters' known objectives |
| Sandbox world generation | StoryBox | A world materializer and four-layer character ontology: a layered data model rather than a context-heavy task simulation |
| Long-form memory evaluation | StoryBench | PostgreSQL truth, forgetting rates, and append-only records: entropy reduction designed for readers |

> DOME shows that long-form generation needs dynamic hierarchical planning and memory augmentation to reduce context conflicts. Multi-Agent Simulation uses a two-stage pattern: simulate characters first, then write the story. CreAgentive decouples story logic and style through a knowledge graph.
>
> **ZongHeng's distinctive step**: most research asks how to generate longer, more coherent stories. ZongHeng asks what happens when a world is built from these primitives, then uses a fifth dimension to control who knows what, who can do what, why they act, which rules they violate, and whether the result can enter the formal truth layer. It is a move from generation algorithms to a narrative engineering system.

---

## Industrial Comparison: More Than a Smarter Pen

| Dimension | Mainstream AI novel tools (such as Sudowrite / Novelcrafter) | ZongHeng Narrative Engine |
|---|---|---|
| Positioning | An AI writing assistant with a better grasp of connective prose | A virtual production studio that checks its own work |
| Core logic | Author plans -> AI helps write -> author reorganizes | System constraints -> world simulation -> character action -> audited commit -> literary rendering |
| Improvement loop | Poor output means another manual retry or undo | An internal fuse loop turns failure samples into a negative-constraint prompt library that improves over time |

---

This repository is a locally run novel-production MVP. Browser pages, existing n8n workflows, and PostgreSQL together implement the product journey; FP008-02 is the V7-defined Node.js high-code exception.

## Quick Start

```powershell
pnpm install --frozen-lockfile
pnpm start
```

The default entry point is `http://127.0.0.1:4176/workbench`. Set `PORT` before starting to use another port. For environment preparation, optional services, and verification commands, see [Local Installation and Running](docs/安装与本地运行.md).

## Documentation

- [Local Installation and Running](docs/安装与本地运行.md): environment, configuration, startup, verification, and failure boundaries.
- [MVP Progress](docs/MVP_PROGRESS.md): the only active progress record, containing real journey results.
- [V7 Design Document](docs/v7设计文档_20260709_终版.md): the authoritative business scope.
- [Execution Rules](AGENTS.md): collaboration, approval, and runtime-change boundaries.

## Repository Layout

```text
apps/web/                       Ten formal Web routes and shared page resources
apps/api/src/features/fp008/    FP008-02 high-code runtime
db/install/                     PostgreSQL canonical data/RPC contract
docs/前端原型_v2/              Page visual and interaction references
docs/后端/n8n/                 Editable n8n workflow attachments
packages/contracts/src/         JSON contracts for pages and RPCs
tests/business/                 Cross-layer business journeys
tests/pages/                    Page, workflow, and runtime verification
```
