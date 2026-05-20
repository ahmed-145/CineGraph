# 100 curated films for Phase 0 — semantic diversity across genre, era, mood, geography
# TMDB IDs verified against tmdb.org at time of writing

SEED_FILMS = [
    # Intense / Obsessive
    {"tmdb_id": 244786, "title": "Whiplash"},
    {"tmdb_id": 45612,  "title": "Black Swan"},
    {"tmdb_id": 641,    "title": "Requiem for a Dream"},
    {"tmdb_id": 3073,   "title": "Pi"},

    # Social Commentary / Dark
    {"tmdb_id": 496243, "title": "Parasite"},
    {"tmdb_id": 419430, "title": "Get Out"},
    {"tmdb_id": 458156, "title": "Us"},
    {"tmdb_id": 37799,  "title": "The Social Network"},
    {"tmdb_id": 546554, "title": "Knives Out"},
    {"tmdb_id": 480414, "title": "Sorry to Bother You"},

    # Slow Burn / Prestige Drama
    {"tmdb_id": 82702,  "title": "Drive"},
    {"tmdb_id": 493922, "title": "Hereditary"},
    {"tmdb_id": 530385, "title": "Midsommar"},
    {"tmdb_id": 404368, "title": "A Ghost Story"},
    {"tmdb_id": 456740, "title": "First Reformed"},
    {"tmdb_id": 262338, "title": "The Witch"},
    {"tmdb_id": 228150, "title": "It Follows"},
    {"tmdb_id": 503919, "title": "The Lighthouse"},

    # Sci-Fi
    {"tmdb_id": 329865, "title": "Arrival"},
    {"tmdb_id": 264660, "title": "Ex Machina"},
    {"tmdb_id": 177572, "title": "Under the Skin"},
    {"tmdb_id": 300668, "title": "Annihilation"},
    {"tmdb_id": 36855,  "title": "Moon"},
    {"tmdb_id": 152601, "title": "Her"},
    {"tmdb_id": 335984, "title": "Blade Runner 2049"},
    {"tmdb_id": 62,     "title": "2001: A Space Odyssey"},
    {"tmdb_id": 157336, "title": "Interstellar"},
    {"tmdb_id": 27205,  "title": "Inception"},
    {"tmdb_id": 9693,   "title": "Children of Men"},
    {"tmdb_id": 545611, "title": "Everything Everywhere All at Once"},

    # Crime / Thriller
    {"tmdb_id": 6977,   "title": "No Country for Old Men"},
    {"tmdb_id": 7345,   "title": "There Will Be Blood"},
    {"tmdb_id": 4977,   "title": "Zodiac"},
    {"tmdb_id": 167810, "title": "Prisoners"},
    {"tmdb_id": 210577, "title": "Gone Girl"},
    {"tmdb_id": 807,    "title": "Se7en"},
    {"tmdb_id": 274,    "title": "The Silence of the Lambs"},
    {"tmdb_id": 670,    "title": "Oldboy"},
    {"tmdb_id": 70,     "title": "Memories of Murder"},
    {"tmdb_id": 550,    "title": "Fight Club"},

    # Drama
    {"tmdb_id": 376867, "title": "Moonlight"},
    {"tmdb_id": 492188, "title": "Marriage Story"},
    {"tmdb_id": 595700, "title": "Roma"},
    {"tmdb_id": 76203,  "title": "12 Years a Slave"},
    {"tmdb_id": 209112, "title": "Boyhood"},
    {"tmdb_id": 194662, "title": "Birdman"},
    {"tmdb_id": 281957, "title": "The Revenant"},
    {"tmdb_id": 424,    "title": "Schindler's List"},

    # Romance
    {"tmdb_id": 391713, "title": "Call Me By Your Name"},
    {"tmdb_id": 590223, "title": "Portrait of a Lady on Fire"},
    {"tmdb_id": 38365,  "title": "Eternal Sunshine of the Spotless Mind"},
    {"tmdb_id": 11798,  "title": "Before Sunrise"},
    {"tmdb_id": 11216,  "title": "In the Mood for Love"},

    # Dark Comedy / Quirky
    {"tmdb_id": 488924, "title": "The Favourite"},
    {"tmdb_id": 120467, "title": "The Grand Budapest Hotel"},
    {"tmdb_id": 275,    "title": "Fargo"},
    {"tmdb_id": 40662,  "title": "Barton Fink"},
    {"tmdb_id": 12454,  "title": "Burn After Reading"},
    {"tmdb_id": 254320, "title": "The Lobster"},
    {"tmdb_id": 266647, "title": "Wild Tales"},

    # Action
    {"tmdb_id": 76341,  "title": "Mad Max: Fury Road"},
    {"tmdb_id": 245891, "title": "John Wick"},
    {"tmdb_id": 72119,  "title": "The Raid: Redemption"},
    {"tmdb_id": 155,    "title": "The Dark Knight"},

    # World Cinema
    {"tmdb_id": 598,    "title": "City of God"},
    {"tmdb_id": 1361,   "title": "Pan's Labyrinth"},
    {"tmdb_id": 4512,   "title": "The Lives of Others"},
    {"tmdb_id": 72105,  "title": "A Separation"},
    {"tmdb_id": 385117, "title": "Toni Erdmann"},
    {"tmdb_id": 392044, "title": "The Square"},
    {"tmdb_id": 252680, "title": "Force Majeure"},
    {"tmdb_id": 87516,  "title": "Amour"},
    {"tmdb_id": 28064,  "title": "The White Ribbon"},
    {"tmdb_id": 306264, "title": "Son of Saul"},
    {"tmdb_id": 44874,  "title": "Certified Copy"},
    {"tmdb_id": 51109,  "title": "Dogtooth"},

    # Classics
    {"tmdb_id": 238,    "title": "The Godfather"},
    {"tmdb_id": 240,    "title": "The Godfather Part II"},
    {"tmdb_id": 28,     "title": "Apocalypse Now"},
    {"tmdb_id": 1911,   "title": "Chinatown"},
    {"tmdb_id": 103,    "title": "Taxi Driver"},
    {"tmdb_id": 15414,  "title": "Network"},
    {"tmdb_id": 539,    "title": "Psycho"},
    {"tmdb_id": 278,    "title": "The Shawshank Redemption"},

    # Art House / Surreal
    {"tmdb_id": 1018,   "title": "Mulholland Drive"},
    {"tmdb_id": 10403,  "title": "Blue Velvet"},
    {"tmdb_id": 7233,   "title": "Synecdoche, New York"},
    {"tmdb_id": 64690,  "title": "The Master"},
    {"tmdb_id": 401981, "title": "Phantom Thread"},
    {"tmdb_id": 60420,  "title": "The Tree of Life"},

    # Horror
    {"tmdb_id": 447332, "title": "A Quiet Place"},
    {"tmdb_id": 1574,   "title": "28 Days Later"},
    {"tmdb_id": 3309,   "title": "Funny Games"},

    # Recent Prestige
    {"tmdb_id": 177677, "title": "Gravity"},
    {"tmdb_id": 661374, "title": "Glass Onion"},
    {"tmdb_id": 376660, "title": "I, Daniel Blake"},
    {"tmdb_id": 419442, "title": "Okja"},
    {"tmdb_id": 742702, "title": "The Father"},
    {"tmdb_id": 168672, "title": "Frances Ha"},
    {"tmdb_id": 637,    "title": "Life is Beautiful"},
]
