# RFCs

Design documents for decisions that are **expensive to reverse** or whose
**reasoning should be findable years later**: public API shape, packaging
and export structure, protocol semantics. Routine features and fixes don't
need an RFC: an issue and a PR are their own record (see
[Proposing changes](../CONTRIBUTING.md#proposing-changes) in the
contributing guide). The live plan for what's being built next is
[ROADMAP.md](../ROADMAP.md).

## Process

1. Create `rfcs/NNNN-short-slug.md` using the next free number (four
   digits, kebab-case slug) and the header block below.
2. Open a PR. The PR discussion **is** the review, no separate forum, no
   fixed comment window.
3. When the PR merges, the RFC is **Accepted** and work can be scheduled.
4. Keep the status current as work proceeds. Once the work ships, the RFC
   becomes **Implemented** and is frozen: corrections and clarifications
   only. New scope means a new RFC, not a reopened one.

Header block:

````md
# RFC NNNN, Title

- **Status:** Draft | Accepted | Implemented | Superseded
- **Author:** …
- **Created:** YYYY-MM-DD
````

An RFC that replaces an earlier one links it with `**Supersedes:**` in its
header, and the replaced RFC's status becomes
`Superseded (by [RFC NNNN](NNNN-short-slug.md))`.

## Index

| RFC                              | Title                     | Status      |
| -------------------------------- | ------------------------- | ----------- |
| [0001](0001-v2-architecture.md)  | DurableWS v2 Architecture | Implemented |
