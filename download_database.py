import requests, gzip, json, io, os
from datetime import datetime, timedelta
import pickle
import numpy as np


def get_person_export(date=None, filename=None, overwrite=True):
    """
    Downloads TMDB's daily person ID export.
    date: datetime object; if None, tries yesterday (today's file
    may not be published yet depending on time of day, UTC 8am cutoff).
    """

    if filename is not None:
        assert filename.endswith(".pkl"), "filename must end with .pkl"
        if os.path.exists(filename) and not overwrite:
            people = pickle.load(open(filename, "rb"))
            return people

    if date is None:
        date = datetime.utcnow() - timedelta(days=1)
    date_str = date.strftime("%m_%d_%Y")

    url = f"http://files.tmdb.org/p/exports/person_ids_{date_str}.json.gz"
    resp = requests.get(url)
    resp.raise_for_status()

    with gzip.open(io.BytesIO(resp.content), "rt", encoding="utf-8") as f:
        people = [json.loads(line) for line in f]

    if filename is not None:
        if os.path.exists(filename):
            if not overwrite:
                raise FileExistsError(f"{filename} already exists and overwrite is False")
            else:
                # Remove file
                os.remove(filename)
        with open(filename, "wb") as f:
            pickle.dump(people, f)

    return people


def compress_people(people=None, filename=None):
    assert (people is not None or filename is not None), "Must provide either people or filename"
    if people is None and filename is not None:
        people = get_person_export(filename=filename, overwrite=False)
    if people is not None and filename is None:
        filename = "person_ids.pkl"

    names = [_["name"] for _ in people]
    ids = np.array([_["id"] for _ in people])
    popularity = np.array([_["popularity"] for _ in people])

    filename_names = filename.replace(".pkl", "_names.lstb")
    filename_ids = filename.replace(".pkl", "_ids.npy")
    filename_popularity = filename.replace(".pkl", "_popularity.npy")

    with open(filename_names, "wb") as f:
        for name in names:
            f.write(name.encode("utf-8") + b"\n")
    np.save(filename_ids, ids.astype(np.uint32))
    np.save(filename_popularity, popularity)

    print("Compressed and saved names, ids, and popularity to .npy files.")


def main():
    people = get_person_export(filename="person_ids.pkl", overwrite=False)
    compress_people(people=people, filename="person_ids.pkl")
    print(len(people), people[0])
    print("here")


if __name__ == "__main__":
    main()
