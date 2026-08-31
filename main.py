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
    return response


def authenticate_test():
    # Authentication
    url_authenticate = BASE_URL + "authentication"
    response = requests.get(url_authenticate, headers=AUTH_HEADER)
    print(response.text)


def search_movies(query):
    url = BASE_URL + "search/movie?query=" + query
    return get_tmbd(url)


def get_detail_movie(movie_id):
    url = BASE_URL + f"movie/{movie_id}"
    return get_tmbd(url)


# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    # authenticate_test()
    result_jr = search_movies("Jack+Reacher")
    id0 = result_jr["results"][0]["id"]
    detail_jr = get_detail_movie(id0)

    test = get_tmbd(f"https://api.themoviedb.org/3/movie/{id0}?append_to_response=credits")
    cast = test["credits"]["cast"]
    tom_cruise = cast[0]

    list_cast = [_["name"] for _ in cast]
    id_cast = [_["id"] for _ in cast]

    test2 = get_tmbd(f"https://api.themoviedb.org/3/person/{id_cast[0]}?append_to_response=movie_credits")

    tomcruise_image = test2["profile_path"]

    tc_image_resp = get_image(tomcruise_image, size="w500", pltshow=True)

    jr_image_resp = get_image(test["poster_path"], size="w500", pltshow=True, filename="jr_poster.jpg")

    print("here")






# See PyCharm help at https://www.jetbrains.com/help/pycharm/
