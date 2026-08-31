import requests
import json
import os
import io
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt


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


def search_movies(query):
    url = BASE_URL + "search/movie?query=" + query
    return get_tmbd(url)


def search_actor(query, confidence_val_popularity=5):
    def print_result(outp):
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

    url = BASE_URL + "search/person?query=" + query
    result = get_tmbd(url)
    if len(result["results"]) == 0:
        # Nothing found
        print(f"No actor found for query: {query}")
        return None
    elif len(result["results"]) == 1:
        # Only one result
        output = result["results"][0]
        print_result(output)
        return output

    # More than one option
    print(f"Found {len(result['results'])} results for query: {query}. Best result:")
    names = [_["name"] for _ in result["results"]]
    popularity = [_["popularity"] for _ in result["results"]]
    max_pop = max(popularity)
    idx_max = popularity.index(max_pop)
    second_max = max([p for p in popularity if p != max_pop], default=0)
    idx_max2 = popularity.index(second_max) if second_max > 0 else None
    if max_pop > confidence_val_popularity + second_max:
        output = result["results"][idx_max]
        print_result(output)
        return output
    else:
        print(f"Multiple options found for query: {query}. Please select one or refine your search.")
        for i, name in enumerate(names):
            print(f"{i + 1}. {name} (Popularity: {popularity[i]})")
        selection = int(input("Enter the number of the actor you want to select (or '0' to cancel) [0]: ") or "0")
        if selection == 0:
            print("Selection cancelled.")
            return None
        else:
            return result["results"][selection - 1]


def get_detail_movie(movie_id):
    url = BASE_URL + f"movie/{movie_id}"
    return get_tmbd(url)


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

    test_search_rosamund = search_actor("Rosamund+Pike", confidence_val_popularity=5)
    test_search_tom = search_actor("Tom+Cruise", confidence_val_popularity=5)





    print("here")






# See PyCharm help at https://www.jetbrains.com/help/pycharm/
