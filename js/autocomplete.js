/* =========================================================
   autocomplete.js — word-level prefix search over the token
   index built by build_search_index.py.

   Files consumed (see that script for the format):
     persons.lstb                display names, one per line
     person_ids.npy              ids, aligned by position with persons.lstb
     person_popularity.npy       popularity, aligned by position
     tokens.lstb                 sorted, distinct, casefolded tokens
     postings_start.npy          CSR row-start offsets into postings
     postings_person_index.npy   person indices, grouped by token,
                                  popularity-descending within each group

   Design notes:
   - Neither .lstb file is split into per-line JS strings; both keep
     raw bytes plus a byte-offset index (Int32Array), and binary
     search runs directly on the bytes (valid UTF-8 byte order ==
     Unicode code point order, so this matches alphabetical order).
   - A query is split into words. All words except the last must be a
     prefix of some token in a candidate's name (already-typed words).
     The last word does the actual prefix search against tokens.lstb.
   - Because postings are pre-sorted by popularity in Python, ranking
     within a single matched token is free — no sorting needed. When a
     short prefix matches several distinct tokens, we merge their
     (already-sorted) candidate sets and do one bounded sort over that
     merged set.
   - ASSUMPTION: tokens were casefolded with Python's str.casefold();
     here we use .toLowerCase(), which matches for virtually all real
     names but can differ on a few unusual characters (e.g. German ß).
   ========================================================= */

/** Wraps raw UTF-8 bytes + a newline-offset index for fast positional decode and, when sorted, prefix binary search. */
class SortedByteList {
  constructor(bytes) {
    this.bytes = bytes;
    this._buildOffsetIndex();
  }

  _buildOffsetIndex() {
    const bytes = this.bytes;
    const n = bytes.length;
    const offsets = [0];
    for (let i = 0; i < n; i++) {
      if (bytes[i] === 0x0a /* \n */) offsets.push(i + 1);
    }
    if (offsets.length > 1 && offsets[offsets.length - 1] === n) offsets.pop();
    this.offsets = Int32Array.from(offsets);
    this.count = this.offsets.length;
  }

  _entryRange(i) {
    const start = this.offsets[i];
    const nextStart = i + 1 < this.count ? this.offsets[i + 1] : this.bytes.length;
    let end = nextStart;
    if (end > start && this.bytes[end - 1] === 0x0a) end -= 1;
    return [start, end];
  }

  decode(i) {
    const [start, end] = this._entryRange(i);
    return new TextDecoder("utf-8").decode(this.bytes.subarray(start, end));
  }

  startsWithPrefix(i, prefixBytes) {
    const [start, end] = this._entryRange(i);
    if (end - start < prefixBytes.length) return false;
    for (let k = 0; k < prefixBytes.length; k++) {
      if (this.bytes[start + k] !== prefixBytes[k]) return false;
    }
    return true;
  }

  _comparePrefix(i, prefixBytes) {
    const [start, end] = this._entryRange(i);
    const len = Math.min(end - start, prefixBytes.length);
    for (let k = 0; k < len; k++) {
      const diff = this.bytes[start + k] - prefixBytes[k];
      if (diff !== 0) return diff;
    }
    return (end - start) - prefixBytes.length;
  }

  /** Requires this list to be sorted. Returns first index whose entry is >= prefixBytes. */
  lowerBound(prefixBytes) {
    let lo = 0, hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._comparePrefix(mid, prefixBytes) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

class PersonAutocomplete {
  constructor() {
    this.ready = false;
    // How many distinct matching tokens to expand for a short prefix,
    // and how many people to pull from each token's (pre-sorted)
    // postings list, before merging and ranking. Tune if needed.
    this.MAX_TOKENS_EXPANDED = 40;
    this.MAX_PER_TOKEN = 25;
  }

  async load(urls) {
    const {
      personsUrl, idsUrl, popularityUrl,
      tokensUrl, postingsStartUrl, postingsIndexUrl,
    } = urls;

    const fetchBuf = (url) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
        return r.arrayBuffer();
      });

    const [personsBuf, idsBuf, popBuf, tokensBuf, postingsStartBuf, postingsIndexBuf] =
      await Promise.all([
        fetchBuf(personsUrl),
        fetchBuf(idsUrl),
        fetchBuf(popularityUrl),
        fetchBuf(tokensUrl),
        fetchBuf(postingsStartUrl),
        fetchBuf(postingsIndexUrl),
      ]);

    this.persons = new SortedByteList(new Uint8Array(personsBuf));
    this.tokens = new SortedByteList(new Uint8Array(tokensBuf));
    this.ids = parseNpy(idsBuf).data;
    this.popularity = parseNpy(popBuf).data;
    this.postingsStart = parseNpy(postingsStartBuf).data;
    this.postingsPersonIndex = parseNpy(postingsIndexBuf).data;

    if (this.ids.length !== this.persons.count || this.popularity.length !== this.persons.count) {
      console.warn(
        `autocomplete: person record count mismatch — persons.lstb has ${this.persons.count} ` +
        `entries, ids has ${this.ids.length}, popularity has ${this.popularity.length}`
      );
    }

    this.ready = true;
  }

  /** True if every token in `personTokens` includes `word` as a prefix. */
  _anyTokenStartsWith(personTokens, word) {
    for (const t of personTokens) {
      if (t.startsWith(word)) return true;
    }
    return false;
  }

  search(query, maxResults = 8) {
    if (!this.ready) return [];

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const lastWord = words[words.length - 1];
    const priorWords = words.slice(0, -1);
    const prefixBytes = new TextEncoder().encode(lastWord);

    let tokenIdx = this.tokens.lowerBound(prefixBytes);
    const candidates = new Map(); // person_idx -> popularity

    let tokensExpanded = 0;
    while (
      tokenIdx < this.tokens.count &&
      tokensExpanded < this.MAX_TOKENS_EXPANDED &&
      this.tokens.startsWithPrefix(tokenIdx, prefixBytes)
    ) {
      const start = this.postingsStart[tokenIdx];
      const end = this.postingsStart[tokenIdx + 1];
      const take = Math.min(end - start, this.MAX_PER_TOKEN);

      for (let k = 0; k < take; k++) {
        const personIdx = this.postingsPersonIndex[start + k];
        if (!candidates.has(personIdx)) {
          candidates.set(personIdx, this.popularity[personIdx]);
        }
      }

      tokenIdx++;
      tokensExpanded++;
    }

    let results = Array.from(candidates.entries()).map(([personIdx, pop]) => ({
      personIdx,
      popularity: pop,
    }));

    // If the query had earlier words (e.g. "Matt Da..."), require them
    // to match too — decode names only for this bounded candidate set.
    if (priorWords.length > 0) {
      results = results.filter(({ personIdx }) => {
        const name = this.persons.decode(personIdx).toLowerCase();
        const nameTokens = name.split(/\s+/);
        return priorWords.every((w) => this._anyTokenStartsWith(nameTokens, w));
      });
    }

    results.sort((a, b) => b.popularity - a.popularity);
    results = results.slice(0, maxResults);

    return results.map(({ personIdx }) => ({
      name: this.persons.decode(personIdx),
      id: this.ids[personIdx],
    }));
  }
}

