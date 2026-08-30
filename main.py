# This is a sample Python script.

# Press ⌃R to execute it or replace it with your code.
# Press Double ⇧ to search everywhere for classes, files, tool windows, actions, and settings.
import requests
import json
import os



def main():

    url = "https://api.themoviedb.org/3/authentication"

    with open("api_key", "r") as f:
        api_key = f.read().strip()
    headers = {
        "accept": "application/json",
        "Authorization": api_key
    }

    response = requests.get(url, headers=headers)

    print(response.text)


# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    main()

# See PyCharm help at https://www.jetbrains.com/help/pycharm/
