/* =========================================================
   tmdb.js — thin wrapper around the TMDB API.

   SECURITY NOTE: the API key is loaded from a plain static file
   (data/api_key.txt) shipped with the site. On GitHub Pages that
   file is publicly downloadable by anyone who visits the page —
   there is no way to keep a key secret in a purely static site.
   Fine for prototyping, but before this is anything but a personal
   tool, move the key behind a small server-side proxy so it's
   never shipped to the browser at all.

   Uses v4 auth: the token is sent as an Authorization: Bearer
   header, not a ?api_key=... query param.
   ========================================================= */

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const API_KEY_URL = "data/api_key.txt";

let apiKeyPromise = null;

function loadApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = fetch(API_KEY_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load API key file (${API_KEY_URL}): ${r.status}`);
        return r.text();
      })
      .then((text) => text.trim());
  }
  return apiKeyPromise;
}

async function tmdbGet(path, params = {}) {
  const apiKey = await loadApiKey();
  const url = new URL(TMDB_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).status_message || ""; } catch { /* ignore */ }
    throw new Error(`TMDB request failed (${res.status}) for ${path}${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

function tmdbImageSourcePath(path) {
  return path ? TMDB_IMAGE_BASE + path : null;
}

/** Actually fetches image bytes (not just building a URL for <img src>), per the "perform another GET" requirement. Falls back to null on failure so the UI can show a placeholder instead of a broken image. */
async function fetchImageObjectUrl(path) {
  const url = tmdbImageSourcePath(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image request failed: ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn(`Could not fetch image ${url}:`, err);
    return null;
  }
}

function genderLabel(genderCode) {
  // TMDB gender codes: 0 = not set, 1 = female, 2 = male, 3 = non-binary
  switch (genderCode) {
    case 1: return "Female";
    case 2: return "Male";
    case 3: return "Non-binary";
    default: return "Not specified";
  }
}

/** Fetches a person plus their movie credits in one call. */
async function fetchPersonWithCredits(personId) {
  return tmdbGet(`/person/${personId}`, { append_to_response: "movie_credits" });
}

/** Fetches the director name(s) for a single movie. */
async function fetchMovieDirectors(movieId) {
  const credits = await tmdbGet(`/movie/${movieId}/credits`);
  return (credits.crew || [])
    .filter((c) => c.job === "Director")
    .map((c) => c.name);
}

/**
 * Combines a person's cast + crew movie credits, dedupes by movie id,
 * and records which role(s) — "cast", "crew", or both — this person
 * had on each one. Always processes both lists, regardless of any
 * cast-only filtering, so role information (e.g. "also crew") is never
 * lost — filtering happens separately in filterCastOnly.
 */
function mergeCreditsWithRoles(person) {
  const cast = person.movie_credits?.cast || [];
  const crew = person.movie_credits?.crew || [];

  const byId = new Map();

  const addCredit = (credit, role) => {
    const existing = byId.get(credit.id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    byId.set(credit.id, {
      id: credit.id,
      title: credit.title,
      posterPath: credit.poster_path,
      popularity: credit.popularity ?? 0,
      releaseDate: credit.release_date,
      overview: credit.overview || "",
      voteAverage: credit.vote_average ?? null,
      roles: [role],
    });
  };

  for (const credit of cast) addCredit(credit, "cast");
  for (const credit of crew) addCredit(credit, "crew");

  return Array.from(byId.values());
}

/**
 * If castOnly is true, drops movies where this person was EXCLUSIVELY
 * crew (roles = ["crew"]). Movies where they were cast — whether cast
 * only, or both cast and crew — are kept either way.
 */
function filterCastOnly(movies, castOnly) {
  return castOnly ? movies.filter((m) => m.roles.includes("cast")) : movies;
}

/**
 * Combines a person's cast + crew movie credits, dedupes by movie id.
 * Unlike getTopMovies, this covers ALL of their credits (not just the
 * top 5) and does NOT fetch directors or poster images — it's used to
 * correlate against another actor's credit list, and only the movies
 * that actually end up in the intersection need their poster fetched.
 *
 * See filterCastOnly for exactly what castOnly does and doesn't exclude.
 */
function getAllMovieCredits(person, castOnly = false) {
  return filterCastOnly(mergeCreditsWithRoles(person), castOnly);
}

/**
 * Combines a person's cast + crew movie credits, dedupes by movie id,
 * sorts by the movie's own popularity, and returns the top `count`
 * with director name(s) and poster image attached.
 *
 * This ALWAYS uses the full union of cast + crew credits — the
 * cast-only checkbox only affects the shared-movies intersection
 * (see getAllMovieCredits / fetchSharedMovies), not a person's own
 * top-5 list. Role info (cast/crew/both) is still attached to each
 * result so it can be displayed either way.
 */
async function getTopMovies(person, count = 5) {
  const merged = mergeCreditsWithRoles(person);
  const sorted = merged.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const top = sorted.slice(0, count);

  const results = [];
  for (const movie of top) {
    let directors = [];
    try {
      directors = await fetchMovieDirectors(movie.id);
    } catch (err) {
      console.warn(`Could not fetch director for movie ${movie.id} (${movie.title}):`, err);
    }

    const posterUrl = await fetchImageObjectUrl(movie.posterPath);

    results.push({
      id: movie.id,
      title: movie.title,
      year: movie.releaseDate ? movie.releaseDate.slice(0, 4) : "Unknown",
      releaseDate: movie.releaseDate || null,
      overview: movie.overview,
      voteAverage: movie.voteAverage,
      director: directors.length ? directors.join(", ") : "Unknown",
      posterUrl,
      roles: movie.roles,
    });
  }

  return results;
}

/**
 * Full pipeline: fetch a person, their general info, top 5 movies, and
 * their complete credit list (for cross-referencing against another
 * actor). castOnly only affects the credit list used for correlation
 * (allMovies) — the top-5 list is always the cast+crew union.
 */
async function fetchActorProfile(personId, castOnly = false) {
  const person = await fetchPersonWithCredits(personId);

  const profileImageUrl = await fetchImageObjectUrl(person.profile_path);

  const generalInfo = {
    id: person.id,
    name: person.name,
    popularity: person.popularity,
    gender: genderLabel(person.gender),
    alsoKnownAs: person.also_known_as || [],
    birthday: person.birthday || "Unknown",
    placeOfBirth: person.place_of_birth || "Unknown",
    biography: person.biography || "No biography available.",
    deathday: person.deathday || null,
    profileImageUrl,
  };

  const topMovies = await getTopMovies(person, 5);
  const allMovies = getAllMovieCredits(person, castOnly);

  return { generalInfo, topMovies, allMovies };
}

/**
 * Given two actor profiles (as returned by fetchActorProfile), finds
 * movies both worked on, sorted by popularity, and fetches a poster
 * image for each. No director lookups here — that's per-movie, and a
 * pair of prolific co-stars could share a lot of films. Includes each
 * actor's role(s) (cast, crew, or both) on that movie.
 */
async function fetchSharedMovies(profile1, profile2) {
  const byId2 = new Map(profile2.allMovies.map((m) => [m.id, m]));
  const shared = profile1.allMovies
    .filter((m) => byId2.has(m.id))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

  return Promise.all(
    shared.map(async (m1) => {
      const m2 = byId2.get(m1.id);
      return {
        id: m1.id,
        title: m1.title,
        year: m1.releaseDate ? m1.releaseDate.slice(0, 4) : "Unknown",
        releaseDate: m1.releaseDate || null,
        overview: m1.overview,
        voteAverage: m1.voteAverage,
        posterUrl: await fetchImageObjectUrl(m1.posterPath),
        tmdbUrl: `https://www.themoviedb.org/movie/${m1.id}`,
        actor1Roles: m1.roles,
        actor2Roles: m2.roles,
      };
    })
  );
}
