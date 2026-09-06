/* =========================================================
   Autocomplete data
   -----------------------------------------------------------
   Loaded once at startup and shared by both actor search
   fields below. Adjust paths if you move the data files.
   ========================================================= */

// Files produced by build_search_index.py — see data/README.md
const DATA_URLS = {
  personsUrl: "data/persons.lstb",
  idsUrl: "data/person_ids.npy",
  popularityUrl: "data/person_popularity.npy",
  tokensUrl: "data/tokens.lstb",
  postingsStartUrl: "data/postings_start.npy",
  postingsIndexUrl: "data/postings_person_index.npy",
};

const personIndex = new PersonAutocomplete();

/* =========================================================
   Actor search field
   -----------------------------------------------------------
   A single search-bar-plus-autocomplete-plus-id-badge unit.
   No free text search happens here — selecting a suggestion
   is the only way to set a value. Two independent instances
   are created below, one per actor.
   ========================================================= */

class ActorSearchField {
  constructor({ input, suggestions, idBadge, index }) {
    this.input = input;
    this.suggestions = suggestions;
    this.idBadge = idBadge;
    this.index = index;
    this.selectedId = null;
    this.activeSuggestionIndex = -1;
    this.debounceTimer = null;

    this.input.addEventListener("input", () => this._onInput());
    this.input.addEventListener("keydown", (e) => this._onKeydown(e));
    this.input.addEventListener("blur", () => {
      // Slight delay so a suggestion's mousedown handler can still fire.
      setTimeout(() => { this.suggestions.hidden = true; }, 100);
    });
  }

  _onInput() {
    this._clearSelection();
    const query = this.input.value.trim();

    clearTimeout(this.debounceTimer);
    if (!query || !this.index.ready) {
      this.suggestions.hidden = true;
      return;
    }

    this.debounceTimer = setTimeout(() => {
      // A single-character query can match a huge number of tokens, so
      // wait for at least 2 characters before searching.
      if (query.length < 2) {
        this.suggestions.hidden = true;
        return;
      }
      this._renderSuggestions(this.index.search(query, 8));
    }, 120);
  }

  _renderSuggestions(matches) {
    this.suggestions.innerHTML = "";
    this.activeSuggestionIndex = -1;

    if (matches.length === 0) {
      this.suggestions.hidden = true;
      return;
    }

    matches.forEach((match) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = match.name;

      const idSpan = document.createElement("span");
      idSpan.className = "suggestion-id";
      idSpan.textContent = match.id;

      li.append(nameSpan, idSpan);
      li.addEventListener("mousedown", (e) => {
        // mousedown (not click) so this fires before the input's blur
        e.preventDefault();
        this._select(match);
      });

      this.suggestions.appendChild(li);
    });

    this.suggestions.hidden = false;
  }

  _select(match) {
    this.input.value = match.name;
    this.selectedId = match.id;
    this.idBadge.textContent = match.id;
    this.idBadge.classList.add("has-value");
    this.suggestions.hidden = true;
    this.activeSuggestionIndex = -1;
    document.dispatchEvent(new CustomEvent("actor-selection-changed"));
  }

  _clearSelection() {
    if (this.selectedId === null) return;
    this.selectedId = null;
    this.idBadge.textContent = "—";
    this.idBadge.classList.remove("has-value");
    document.dispatchEvent(new CustomEvent("actor-selection-changed"));
  }

  _onKeydown(e) {
    const items = this.suggestions.querySelectorAll("li");
    if (this.suggestions.hidden || items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this._updateActive(Math.min(this.activeSuggestionIndex + 1, items.length - 1), items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this._updateActive(Math.max(this.activeSuggestionIndex - 1, 0), items);
    } else if (e.key === "Enter" && this.activeSuggestionIndex >= 0) {
      e.preventDefault();
      items[this.activeSuggestionIndex].dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      this.suggestions.hidden = true;
      this.activeSuggestionIndex = -1;
    }
  }

  _updateActive(newIndex, items) {
    items.forEach((el) => el.setAttribute("aria-selected", "false"));
    if (newIndex >= 0 && newIndex < items.length) {
      items[newIndex].setAttribute("aria-selected", "true");
      items[newIndex].scrollIntoView({ block: "nearest" });
    }
    this.activeSuggestionIndex = newIndex;
  }
}

const actor1 = new ActorSearchField({
  input: document.getElementById("actor1-input"),
  suggestions: document.getElementById("actor1-suggestions"),
  idBadge: document.getElementById("actor1-id"),
  index: personIndex,
});

const actor2 = new ActorSearchField({
  input: document.getElementById("actor2-input"),
  suggestions: document.getElementById("actor2-suggestions"),
  idBadge: document.getElementById("actor2-id"),
  index: personIndex,
});

personIndex.load(DATA_URLS).catch((err) => {
  console.error("Could not load autocomplete data:", err);
  actor1.input.placeholder = "Search (autocomplete unavailable)";
  actor2.input.placeholder = "Search (autocomplete unavailable)";
});

/* =========================================================
   Command button
   -----------------------------------------------------------
   Placeholder — this is where the real JS command goes once
   the backend logic is rewritten in JS. It currently just
   reports the two selected IDs. Replace runCommand()'s body
   with the actual call.
   ========================================================= */

const runCommandBtn = document.getElementById("run-command-btn");
const commandOutput = document.getElementById("command-output");
const actor1Profile = document.getElementById("actor1-profile");
const actor2Profile = document.getElementById("actor2-profile");

function addMetaRow(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

function tmdbMovieUrl(id) {
  return `https://www.themoviedb.org/movie/${id}`;
}

/** Wraps an <img> (or a placeholder) in a link to the movie's TMDB page. */
function renderPosterLink(movie) {
  const link = document.createElement("a");
  link.className = "poster-link";
  link.href = tmdbMovieUrl(movie.id);
  link.target = "_blank";
  link.rel = "noopener";

  if (movie.posterUrl) {
    const img = document.createElement("img");
    img.className = "movie-poster";
    img.src = movie.posterUrl;
    img.alt = movie.title;
    link.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "movie-poster movie-poster-placeholder";
    placeholder.textContent = "No poster";
    link.appendChild(placeholder);
  }

  return link;
}

function formatReleaseDate(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Age in whole years on a given date, or null if either date is missing/invalid. */
function computeAge(birthday, onDateStr) {
  if (!birthday || birthday === "Unknown" || !onDateStr) return null;
  const birth = new Date(birthday);
  const on = new Date(onDateStr);
  if (isNaN(birth) || isNaN(on)) return null;

  let age = on.getFullYear() - birth.getFullYear();
  const hadBirthdayByThen =
    on.getMonth() > birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() >= birth.getDate());
  if (!hadBirthdayByThen) age--;
  return age;
}

/**
 * Builds the hover tooltip for a movie card. `ageInfo`, when provided
 * (shared-movies cards only), is shown above the rest of the details.
 * Synopsis/release date/rating come from data already fetched as part
 * of the person's credits — no extra API calls needed for this.
 */
function buildMovieTooltip(movie, ageInfo) {
  const tooltip = document.createElement("div");
  tooltip.className = "movie-tooltip";

  if (ageInfo) {
    const ages = document.createElement("p");
    ages.className = "tooltip-ages";
    const a1 = ageInfo.actor1Age != null ? `${ageInfo.actor1Age}` : "?";
    const a2 = ageInfo.actor2Age != null ? `${ageInfo.actor2Age}` : "?";
    const diff = ageInfo.ageDiff != null ? `${ageInfo.ageDiff}` : "?";
    ages.textContent =
      `${ageInfo.actor1Name}: ${a1} · ${ageInfo.actor2Name}: ${a2} · Age gap: ${diff}`;
    tooltip.appendChild(ages);
  }

  const release = document.createElement("p");
  release.className = "tooltip-line";
  release.textContent = `Released: ${formatReleaseDate(movie.releaseDate)}`;
  tooltip.appendChild(release);

  if (movie.voteAverage != null) {
    const rating = document.createElement("p");
    rating.className = "tooltip-line";
    rating.textContent = `Rating: ${Number(movie.voteAverage).toFixed(1)} / 10`;
    tooltip.appendChild(rating);
  }

  const overview = document.createElement("p");
  overview.className = "tooltip-overview";
  overview.textContent = movie.overview || "No synopsis available.";
  tooltip.appendChild(overview);

  return tooltip;
}

function renderMovieCard(movie) {
  const card = document.createElement("div");
  card.className = "movie-card";
  card.appendChild(renderPosterLink(movie));

  const title = document.createElement("p");
  title.className = "movie-title";
  title.textContent = `${movie.title} (${movie.year})`;

  const director = document.createElement("p");
  director.className = "movie-director";
  director.textContent = `Dir. ${movie.director} · ${formatRoles(movie.roles)}`;

  card.append(title, director);
  card.appendChild(buildMovieTooltip(movie));
  return card;
}

/** Poster + title only, no director — used for the shared-movies block, since resolving directors for every movie two prolific actors have in common could mean a lot of extra requests. */
function formatRoles(roles) {
  if (roles.includes("cast") && roles.includes("crew")) return "Cast & Crew";
  if (roles.includes("crew")) return "Crew";
  return "Cast";
}

/**
 * actor1Info/actor2Info are { name, birthday } — birthday is used to
 * compute each actor's age when the movie came out, for the tooltip.
 */
function renderSharedMovieCard(movie, actor1Info, actor2Info) {
  const card = document.createElement("div");
  card.className = "movie-card";
  card.appendChild(renderPosterLink(movie));

  const title = document.createElement("p");
  title.className = "movie-title";
  title.textContent = `${movie.title} (${movie.year})`;
  card.appendChild(title);

  const roles = document.createElement("p");
  roles.className = "movie-director";
  roles.textContent =
    `${actor1Info.name}: ${formatRoles(movie.actor1Roles)} · ` +
    `${actor2Info.name}: ${formatRoles(movie.actor2Roles)}`;
  card.appendChild(roles);

  const age1 = computeAge(actor1Info.birthday, movie.releaseDate);
  const age2 = computeAge(actor2Info.birthday, movie.releaseDate);
  const ageDiff = age1 != null && age2 != null ? Math.abs(age1 - age2) : null;

  card.appendChild(
    buildMovieTooltip(movie, {
      actor1Name: actor1Info.name,
      actor1Age: age1,
      actor2Name: actor2Info.name,
      actor2Age: age2,
      ageDiff,
    })
  );

  return card;
}

function tmdbPersonUrl(id) {
  return `https://www.themoviedb.org/person/${id}`;
}

function renderActorProfile(container, { generalInfo, topMovies }) {
  container.innerHTML = "";
  container.hidden = false;

  const header = document.createElement("div");
  header.className = "profile-header";

  const photoLink = document.createElement("a");
  photoLink.className = "poster-link profile-photo-link";
  photoLink.href = tmdbPersonUrl(generalInfo.id);
  photoLink.target = "_blank";
  photoLink.rel = "noopener";

  if (generalInfo.profileImageUrl) {
    const img = document.createElement("img");
    img.className = "profile-photo";
    img.src = generalInfo.profileImageUrl;
    img.alt = generalInfo.name;
    photoLink.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "profile-photo profile-photo-placeholder";
    placeholder.textContent = "No photo";
    photoLink.appendChild(placeholder);
  }
  header.appendChild(photoLink);

  const headerText = document.createElement("div");
  const nameLink = document.createElement("a");
  nameLink.className = "profile-name-link";
  nameLink.href = tmdbPersonUrl(generalInfo.id);
  nameLink.target = "_blank";
  nameLink.rel = "noopener";
  const nameEl = document.createElement("h3");
  nameEl.className = "profile-name";
  nameEl.textContent = generalInfo.name;
  nameLink.appendChild(nameEl);
  const popEl = document.createElement("p");
  popEl.className = "profile-popularity";
  popEl.textContent = `Popularity: ${Number(generalInfo.popularity).toFixed(1)}`;
  headerText.append(nameLink, popEl);
  header.appendChild(headerText);
  container.appendChild(header);

  const meta = document.createElement("dl");
  meta.className = "profile-meta";
  addMetaRow(meta, "Gender", generalInfo.gender);
  if (generalInfo.alsoKnownAs.length > 0) {
    addMetaRow(meta, "Also known as", generalInfo.alsoKnownAs.join(", "));
  }
  addMetaRow(meta, "Born", generalInfo.birthday);
  addMetaRow(meta, "Place of birth", generalInfo.placeOfBirth);
  if (generalInfo.deathday) {
    addMetaRow(meta, "Died", generalInfo.deathday);
  }
  container.appendChild(meta);

  const bio = document.createElement("p");
  bio.className = "profile-bio";
  bio.textContent = generalInfo.biography;
  container.appendChild(bio);

  const moviesTitle = document.createElement("h4");
  moviesTitle.className = "profile-movies-title";
  moviesTitle.textContent = "Top 5 movies";
  container.appendChild(moviesTitle);

  const grid = document.createElement("div");
  grid.className = "movie-grid";
  if (topMovies.length === 0) {
    const none = document.createElement("p");
    none.className = "profile-bio";
    none.textContent = "No movie credits found.";
    grid.appendChild(none);
  } else {
    for (const movie of topMovies) grid.appendChild(renderMovieCard(movie));
  }
  container.appendChild(grid);
}

const sharedMoviesSection = document.getElementById("shared-movies-block");
const sharedMoviesGrid = document.getElementById("shared-movies-grid");
const sharedMoviesTitle = document.getElementById("shared-movies-title");

function renderSharedMovies(movies, actor1Info, actor2Info) {
  sharedMoviesGrid.innerHTML = "";
  sharedMoviesSection.hidden = false;

  sharedMoviesTitle.textContent =
    movies.length > 0
      ? `Movies with both actors (${movies.length})`
      : "Movies with both actors";

  if (movies.length === 0) {
    const none = document.createElement("p");
    none.className = "profile-bio";
    none.textContent = "No movies in common.";
    sharedMoviesGrid.appendChild(none);
    return;
  }

  for (const movie of movies) {
    sharedMoviesGrid.appendChild(renderSharedMovieCard(movie, actor1Info, actor2Info));
  }
}

async function runCommand() {
  if (actor1.selectedId === null || actor2.selectedId === null) {
    commandOutput.textContent = "Select both actors before running a command.";
    return;
  }

  runCommandBtn.disabled = true;
  runCommandBtn.textContent = "Loading…";
  commandOutput.textContent = "";
  actor1Profile.hidden = true;
  actor2Profile.hidden = true;
  sharedMoviesSection.hidden = true;

  try {
    const castOnly1 = document.getElementById("actor1-cast-only").checked;
    const castOnly2 = document.getElementById("actor2-cast-only").checked;

    const [profile1, profile2] = await Promise.all([
      fetchActorProfile(actor1.selectedId, castOnly1),
      fetchActorProfile(actor2.selectedId, castOnly2),
    ]);
    renderActorProfile(actor1Profile, profile1);
    renderActorProfile(actor2Profile, profile2);

    const sharedMovies = await fetchSharedMovies(profile1, profile2);
    renderSharedMovies(
      sharedMovies,
      { name: profile1.generalInfo.name, birthday: profile1.generalInfo.birthday },
      { name: profile2.generalInfo.name, birthday: profile2.generalInfo.birthday }
    );
  } catch (err) {
    console.error("TMDB lookup failed:", err);
    commandOutput.textContent = `Something went wrong talking to TMDB: ${err.message}`;
  } finally {
    runCommandBtn.disabled = false;
    runCommandBtn.textContent = "Search";
  }
}

runCommandBtn.addEventListener("click", runCommand);
