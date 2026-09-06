#!/usr/bin/env python3
"""
build_search_index.py — one-time conversion of the raw person data into a
format built for fast prefix / surname search in the browser.

Run once:
    python build_search_index.py \
        --names person_ids_names.lstb \
        --ids person_ids_ids.npy \
        --popularity person_ids_popularity.npy \
        --out search_index/

WHAT THIS BUILDS AND WHY
-------------------------------------------------------------------------
The original format lets you binary-search *full names* by prefix, but not
individual words — so searching "Damon" would never find "Matt Damon".

To support word-level search efficiently at 5M-entry scale, this script
builds an inverted index:

  1. Every name is split into words (tokens), casefolded for
     case-insensitive matching.
  2. Each DISTINCT token is stored once (there are far fewer distinct
     words than names — common surnames/first names repeat a lot).
  3. For each distinct token, we store the list of people who have that
     token in their name, already sorted by popularity (descending).
     Sorting happens here, once, in Python — so the browser never has to
     sort a large candidate set at query time, it just reads the
     already-ranked list.

This is a classic CSR-style (compressed sparse row) inverted index:

  tokens.lstb              sorted, newline-separated distinct tokens
  postings_start.npy       int32[num_tokens + 1] — postings_start[i] is
                            where token i's people begin in the postings
                            array (postings_start[i+1] is where it ends)
  postings_person_index.npy int32[total occurrences] — person indices,
                            grouped by token, popularity-descending
                            within each group

Plus the per-person records, carried through basically unchanged:

  persons.lstb              newline-separated display names (original
                             casing/spacing preserved)
  person_ids.npy             ids, same order as persons.lstb
  person_popularity.npy      popularity, same order as persons.lstb

Position i in persons.lstb / person_ids.npy / person_popularity.npy all
refer to the same person — exactly like the original format.

ASSUMPTIONS (adjust if these don't hold for your data):
  - Tokens are split on whitespace only. "Jean-Luc" and "O'Brien" are
    kept as single tokens, not split further.
  - Case folding uses Python's str.casefold(), which is the standard
    approach and handles more edge ccases than a plain .lower() (e.g.
    German ß). The JS side uses .toLowerCase(), which is very close but
    not 100% identical for a handful of exotic characters.
  - If a name repeats the same word twice, it's only indexed once for
    that person (no duplicate postings for one person/token pair).
"""

import argparse
import os
import sys
import numpy as np


def load_names(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    names = text.split("\n")
    # A trailing newline in the source file produces one trailing empty
    # entry after split() — drop it rather than treating it as a person.
    if names and names[-1] == "":
        names.pop()
    return names


def build_index(names, ids, popularity):
    n = len(names)
    if not (len(ids) == n and len(popularity) == n):
        raise ValueError(
            f"Length mismatch: {n} names, {len(ids)} ids, {len(popularity)} popularity"
        )

    token_map = {}  # token -> list of (popularity, person_idx)

    for person_idx in range(n):
        words = names[person_idx].split()
        seen_tokens = set()
        for w in words:
            tok = w.casefold()
            if not tok or tok in seen_tokens:
                continue
            seen_tokens.add(tok)
            token_map.setdefault(tok, []).append((popularity[person_idx], person_idx))

        if person_idx and person_idx % 500_000 == 0:
            print(f"  tokenized {person_idx:,}/{n:,}", file=sys.stderr)

    tokens_sorted = sorted(token_map.keys())
    num_tokens = len(tokens_sorted)

    postings_start = np.zeros(num_tokens + 1, dtype=np.int32)
    postings_person_index = np.empty(
        sum(len(v) for v in token_map.values()), dtype=np.int32
    )

    cursor = 0
    for i, tok in enumerate(tokens_sorted):
        entries = token_map[tok]
        entries.sort(key=lambda e: e[0], reverse=True)  # popularity descending
        postings_start[i] = cursor
        for _, person_idx in entries:
            postings_person_index[cursor] = person_idx
            cursor += 1
    postings_start[num_tokens] = cursor

    return tokens_sorted, postings_start, postings_person_index


def write_lstb(path, entries):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(entries))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--names", required=True, help="path to person_ids_names.lstb")
    parser.add_argument("--ids", required=True, help="path to person_ids_ids.npy")
    parser.add_argument("--popularity", required=True, help="path to person_ids_popularity.npy")
    parser.add_argument("--out", required=True, help="output directory for the search index")
    args = parser.parse_args()

    print("Loading input files...")
    names = load_names(args.names)
    ids = np.load(args.ids)
    popularity = np.load(args.popularity)
    print(f"  {len(names):,} names loaded")

    print("Building token index (this is the slow part, one pass over all names)...")
    tokens_sorted, postings_start, postings_person_index = build_index(names, ids, popularity)
    print(f"  {len(tokens_sorted):,} distinct tokens, {len(postings_person_index):,} postings")

    os.makedirs(args.out, exist_ok=True)

    print("Writing output files...")
    write_lstb(os.path.join(args.out, "persons.lstb"), names)
    write_lstb(os.path.join(args.out, "tokens.lstb"), tokens_sorted)
    np.save(os.path.join(args.out, "person_ids.npy"), ids)
    np.save(os.path.join(args.out, "person_popularity.npy"), popularity.astype(np.float32))
    np.save(os.path.join(args.out, "postings_start.npy"), postings_start)
    np.save(os.path.join(args.out, "postings_person_index.npy"), postings_person_index)

    print("Done. Files written to", args.out)
    for fname in [
        "persons.lstb", "tokens.lstb", "person_ids.npy",
        "person_popularity.npy", "postings_start.npy", "postings_person_index.npy",
    ]:
        fpath = os.path.join(args.out, fname)
        size_mb = os.path.getsize(fpath) / (1024 * 1024)
        print(f"  {fname}: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
