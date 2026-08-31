import requests
import json
import os
import io
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
from collections import Counter


def duplicates_set(lst):
    seen = set()
    dupes = set()
    for item in lst:
        if item in seen:
            dupes.add(item)
        else:
            seen.add(item)
    return list(dupes)


def sort_x_by_y(x, y, reverse_list=False):
    if reverse_list:
        return [x for _, x in reversed(sorted(zip(y, x)))]
    else:
        return [x for _, x in sorted(zip(y, x))]


def flatten_list(xss):
    return [x for xs in xss for x in xs]


def get_api_key():
    with open("api_key", "r") as f:
        api_key = f.read().strip()
    return api_key


TMDB_API_KEY = get_api_key()
AUTH_HEADER = {"Authorization": TMDB_API_KEY}
TMDB_CONFIG = json.load(open("tmdb_config.json", "r"))
BASE_URL = "https://api.themoviedb.org/3/"


def get_image(image_path, size="original", savepath=None, filename=None, pltshow=False):
    """
    Gets the image and converts it into numpy array.
    Optionally, saves to disk and shows the image using matplotlib.

    :param image_path:
    :param size:
    :param savepath:
    :param filename:
    :param pltshow:
    :return:
    """
    base_url = TMDB_CONFIG["images"]["secure_base_url"]
    size = size if size in TMDB_CONFIG["images"]["poster_sizes"] else "original"
    image_url = f"{base_url}{size}{image_path}"
    resp = requests.get(image_url, headers=AUTH_HEADER)
    image_bytes = resp.content

    if savepath is not None or filename is not None:
        if savepath is None:
            savepath = "working_folder"
        os.makedirs(savepath, exist_ok=True)
        if filename is None:
            filename = image_path
        full_path = os.path.join(savepath, filename)
        with open(full_path, "wb") as f:
            f.write(image_bytes)

    # Converts raw bytes into image and then converts the image into a numpy array
    img = Image.open(io.BytesIO(image_bytes))
    arr = np.array(img)

    if pltshow:
        plt.imshow(arr)
        plt.axis("off")
        plt.show()

    return arr


def get_tmbd(url):
    response = requests.get(url, headers=AUTH_HEADER)
    response.raise_for_status()
    return response.json()


def authenticate_test():
    # Authentication
    url_authenticate = BASE_URL + "authentication"
    response = requests.get(url_authenticate, headers=AUTH_HEADER)
    print(response.text)


def search_tmdb(query, search_type="movie", confidence_val_popularity=5):
    def print_result_actor(outp):
        print(f"Found ({'F' if outp['gender'] == 1 else 'M' if outp['gender'] == 2 else 'N/A'}) {outp['name']}")
        print(f"Popularity:{outp['popularity']}")
        print(f"Known for:")
        for movie_known_for in range(len(outp['known_for'])):
            item = outp['known_for'][movie_known_for]
            title = item['title'] if 'title' in item else item['name']
            media_type = item['media_type']
            pop = item['popularity']
            score = item['vote_average'] if 'vote_average' in item else 'N/A'
            print(f"  {movie_known_for + 1}. {title} ({media_type}) - Popularity: {pop}, Score: {score}")

    def print_result_movie(outp):
        print(f"Found movie: {outp['title']} (Release Date: {outp.get('release_date', 'N/A')})")
        print(f"Popularity: {outp['popularity']}")
        print(f"Score: {outp.get('vote_average', 'N/A')}, Vote count: {outp.get('vote_count', 'N/A'):,}")
        print(f"Original language: {outp.get('original_language', 'N/A')}")
        print(f"Overview: {outp.get('overview', 'N/A')}")

    def print_result(outp):
        if search_type == "movie":
            print_result_movie(outp)
        elif search_type == "person":
            print_result_actor(outp)
        else:
            raise NotImplementedError(
                f"Search type '{search_type}' is not implemented. Please use 'movie' or 'person'.")

    if search_type == "movie":
        url = BASE_URL + "search/movie?query=" + query
    elif search_type == "person":
        url = BASE_URL + "search/person?query=" + query
    else:
        raise NotImplementedError(f"Search type '{search_type}' is not implemented. Please use 'movie' or 'person'.")
    result = get_tmbd(url)

    if len(result["results"]) == 0:
        print(f"No {search_type} found for query: {query}")
        return None
    elif len(result["results"]) == 1:
        output = result["results"][0]
        print_result(output)
        return output

    # More than one result
    names = [_["name"] if search_type == "person" else _["title"] for _ in result["results"]]
    popularity = [_["popularity"] for _ in result["results"]]
    max_pop = max(popularity)
    cutoff_popularity = max_pop / confidence_val_popularity
    list_above_cutoff = [result["results"][i] for i, p in enumerate(popularity) if p >= cutoff_popularity]
    list_below_cutoff = [result["results"][i] for i, p in enumerate(popularity) if p < cutoff_popularity]
    more_options = len(list_below_cutoff)
    if len(list_above_cutoff) == 1:
        print(f"Found {len(result['results'])} results for query: {query}. Best result:")
        output = list_above_cutoff[0]
        print_result(output)
        return output

    print(f"Multiple options ({len(result['results'])}) found for query: {query}. "
          f"Best options ({len(list_above_cutoff)}) are shown. Please select one or refine your search.")
    dict_with_options = {}
    for i, possible_result in enumerate(list_above_cutoff):
        print(f"\n{i + 1}. {possible_result['name'] if search_type == 'person' else possible_result['title']} "
              f"(Popularity: {possible_result['popularity']})")
        print_result(possible_result)
        dict_with_options[i + 1] = possible_result
    if more_options > 0:
        print(f"\nThere are more ({len(list_below_cutoff)}) options available with lower popularity. "
              f"Enter '-1' to see them.")
    selection = int(input("\nEnter the number of the result you want to select (or '0' to cancel) [0]: ") or "0")
    if selection == -1:
        print(f"\nShowing more options ({len(list_below_cutoff)}):")
        for i, possible_result in enumerate(list_below_cutoff):
            print(f"\n{i + 1 + len(list_above_cutoff)}. "
                  f"{possible_result['name'] if search_type == 'person' else possible_result['title']} "
                  f"(Popularity: {possible_result['popularity']})")
            print_result(possible_result)
            dict_with_options[i + 1 + len(list_above_cutoff)] = possible_result
        selection = int(input("\nEnter the number of the result you want to select (or '0' to cancel) [0]: ") or "0")

    if selection == 0:
        print("Selection cancelled.")
        return None

    if selection > 0:
        if selection not in dict_with_options.keys():
            raise ValueError(
                f"Invalid selection. Please select a number between 1 and {max(dict_with_options.keys())} (or 0 to cancell, or -1 to show additional options (if applicable)).")
        else:
            name = dict_with_options[selection]['name'] if search_type == 'person' else \
                dict_with_options[selection]['title']
            print(f"Selected result: {name}")
            return dict_with_options[selection]


def get_detail_movie(movie_id):
    url = BASE_URL + f"movie/{movie_id}?append_to_response=credits&imdb_id&character_names&revenue&budget&created_by"
    return get_tmbd(url)


def get_movie_credits(id_movie):
    return get_tmbd(f"{BASE_URL}movie/{id_movie}?append_to_response=credits")


def get_person_filmography(id_person):
    return get_tmbd(f"{BASE_URL}person/{id_person}?append_to_response=movie_credits")


def find_movies_worked_together(actors_id: list = None, actors_names: list = None, only_cast=False):
    assert actors_id is not None or actors_names is not None, "ids or names need to be given"
    if actors_id is None and actors_names is not None:
        raise NotImplementedError("Search within this function not implemented yet.")

    actors_dict = {}
    actors_dict_movie_ids = {}
    actors_movies_id = []
    list_names = [] if actors_names is None else actors_names
    for actor in actors_id:
        result = get_person_filmography(actor)
        actors_dict[result["name"]] = result
        if actors_names is None:
            list_names.append(result["name"])

        tmp = {}
        tmp_avoid_repeat_cast_and_crew = []
        for job in result["movie_credits"].keys():
            tmp2 = [_["id"] for _ in result["movie_credits"][job]]
            tmp[job] = tmp2
            tmp_avoid_repeat_cast_and_crew += tmp2
        actors_movies_id.append(list(set(tmp_avoid_repeat_cast_and_crew)))
        actors_dict_movie_ids[result["name"]] = tmp
    actors_movies_id_combined = flatten_list(actors_movies_id)

    number_movies = [len(actors_dict_movie_ids[name]["cast"]) + len(actors_dict_movie_ids[name]["crew"]) for name in list_names]
    shortest_filmography_actor = list_names[number_movies.index(min(number_movies))]
    actors_movies_id_copy = actors_movies_id_combined.copy()
    movies_in_both_ids = duplicates_set(actors_movies_id_copy)

    movies_both = []
    for movie in movies_in_both_ids:
        if only_cast:
            idx_shortest = actors_dict_movie_ids[shortest_filmography_actor]["cast"].index(movie)
            movies_both.append(actors_dict[shortest_filmography_actor]["movie_credits"]["cast"][idx_shortest])
        else:
            if movie in actors_dict_movie_ids[shortest_filmography_actor]["cast"]:
                idx_shortest = actors_dict_movie_ids[shortest_filmography_actor]["cast"].index(movie)
                movies_both.append(actors_dict[shortest_filmography_actor]["movie_credits"]["cast"][idx_shortest])
            else:
                idx_shortest = actors_dict_movie_ids[shortest_filmography_actor]["crew"].index(movie)
                movies_both.append(actors_dict[shortest_filmography_actor]["movie_credits"]["crew"][idx_shortest])

    name_movies_both = [_["title"] for _ in movies_both]
    popularity = [_["popularity"] for _ in movies_both]
    movies_both = sort_x_by_y(movies_both, popularity, reverse_list=True)

    if len(movies_both) == 1:
        print(f"\nONLY ONE MOVIE! - {movies_both[0]['title']}")
        result = get_detail_movie(movies_both[0]['id'])
        return result
    else:
        print(f"\nMore than one movie! ({len(movies_both)})")
        for i, _ in enumerate(movies_both):
            print(f"{i + 1}. {_['title']} ({_['release_date'][:4]})")

        padding_names = max(max([len(_) for _ in list_names]), 10)
        print("What did they work as:")
        print("    " + list_names[0].ljust(padding_names) + "|" + list_names[1].ljust(padding_names))
        print("    " + "Cast Crew ".ljust(padding_names) + "|" + "Cast Crew ".ljust(padding_names))

        def convert_tuple_to_str(t, pad):
            if t:
                return "X".ljust(pad)
            else:
                return " ".ljust(pad)
        for i, mov in enumerate(movies_both):
            actor_credit = []
            for act in list_names:
                actor_credit.append((mov["id"] in actors_dict_movie_ids[act]["cast"], mov["id"] in actors_dict_movie_ids[act]["crew"]))
            actor_strings = " |".join(["".join(list((convert_tuple_to_str(_, 5) for _ in x))) for x in actor_credit])
            out_str = f"{i + 1:2}. {actor_strings}"
            print(out_str)

        return name_movies_both



# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    # authenticate_test()

    # result_jr = search_movies("Jack+Reacher")
    # id0 = result_jr["results"][0]["id"]
    # detail_jr = get_detail_movie(id0)
    #
    # test = get_tmbd(f"https://api.themoviedb.org/3/movie/{id0}?append_to_response=credits")
    # cast = test["credits"]["cast"]
    # tom_cruise = cast[0]
    #
    # list_cast = [_["name"] for _ in cast]
    # id_cast = [_["id"] for _ in cast]
    #
    # test2 = get_tmbd(f"https://api.themoviedb.org/3/person/{id_cast[0]}?append_to_response=movie_credits")

    # tomcruise_image = test2["profile_path"]
    # tc_image_resp = get_image(tomcruise_image, size="w500", pltshow=True)
    # jr_image_resp = get_image(test["poster_path"], size="w500", pltshow=True, filename="jr_poster.jpg")

    # tom = search_actor("Tom+Cruise")
    # rosamund = search_actor("Rosamund+Pike")

    # list_result_tom = [_["name"] for _ in tom["results"]]
    # popularity_tom = [_["popularity"] for _ in tom["results"]]
    # a = tom["results"][0]
    # b = tom["results"][1]
    # q = rosamund["results"]

    # test_search_rosamund = search_tmdb("Rosamund+Pike", "person", confidence_val_popularity=5)
    # print("\n\n\n")
    # test_search_tom = search_tmdb("Tom+Cruise", "person", confidence_val_popularity=5)

    # test_search_gone_girl = search_tmdb("Gone Girl")
    # print("\n\n\n")
    # test_search_mission_impossible = search_tmdb("Mission Impossible")

    # tom = search_tmdb("Tom Cruise", "person")
    # rosamund = search_tmdb("Rosamund Pike", "person")
    # q = find_movies_worked_together([tom["id"], rosamund["id"]])

    matt_damon = search_tmdb("Matt Damon", "person")
    ben_affleck = search_tmdb("Ben Affleck", "person")
    q = find_movies_worked_together([matt_damon["id"], ben_affleck["id"]])



    print("here")

