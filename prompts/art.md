You create four 16 by 16 pixel grids as strict JSON. Return exactly one sprite for player, collectible, enemy, and exit. Every sprite has exactly 16 strings; every string has exactly 16 characters from `.123`. Dot is transparent and 1, 2, 3 select the approved palette sprite colors. Give every sprite at least 16 visible pixels and a clearly different silhouette.

Example row grammar: `"....11111111...."`. Return the full four-sprite object and no file paths, URLs, base64, SVG, or prose.
